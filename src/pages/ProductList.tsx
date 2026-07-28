import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType, doc, setDoc, deleteDoc } from '../firebase';
import { useAuth } from '../AuthContext';
import { useLedger } from '../LedgerContext';
import { Product } from '../types';
import { syncCollection } from '../lib/syncCache';
import { getCacheItem, setCacheItem } from '../lib/idbCache';
import { Search, Plus, Trash2, Edit2, Package, Sparkles, X } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

export default function ProductList() {
  const { currentUser } = useAuth();
  const { activeLedger } = useLedger();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  // Modal Inputs
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');

  // Sync Products from cached database
  const loadProducts = async () => {
    if (!activeLedger?.id) return;
    const items = await syncCollection<Product>('products', activeLedger.id, 'products');
    setProducts(items);
  };

  useEffect(() => {
    loadProducts();

    const handleSync = () => {
      loadProducts();
    };
    window.addEventListener('database-synced', handleSync);
    return () => {
      window.removeEventListener('database-synced', handleSync);
    };
  }, [activeLedger?.id]);

  const handleOpenAdd = () => {
    setEditingProduct(null);
    setName('');
    setSku('');
    setPrice('');
    setStock('');
    setShowAddModal(true);
  };

  const handleOpenEdit = (p: Product) => {
    setEditingProduct(p);
    setName(p.name);
    setSku(p.sku);
    setPrice(p.price.toString());
    setStock(p.stock.toString());
    setShowAddModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLedger?.id) return;

    const numPrice = parseFloat(price) || 0;
    const numStock = parseInt(stock, 10) || 0;
    const id = editingProduct ? editingProduct.id : uuidv4();

    const newProduct: Product = {
      id,
      ledgerId: activeLedger.id,
      name,
      sku: sku || `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
      price: numPrice,
      stock: numStock,
      updatedAt: Date.now()
    };

    try {
      // 1. Optimistic local state update and instant modal close
      const updatedList = editingProduct 
        ? products.map(p => p.id === id ? newProduct : p)
        : [...products, newProduct];
      setProducts(updatedList);
      setShowAddModal(false);

      // 2. Save cache & Firestore write in background
      setCacheItem<Product>('products', newProduct);
      const docRef = doc(db, 'products', id);
      setDoc(docRef, newProduct);
      const serverVerRef = doc(db, 'cache_versions', activeLedger.id);
      setDoc(serverVerRef, { products: Date.now() }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.CREATE, `products/${id}`);
    }
  };

  const handleDelete = async (id: string) => {
    if (!activeLedger?.id || !confirm('Are you sure you want to delete this product?')) return;

    try {
      // 1. Optimistic update
      setProducts(products.filter(p => p.id !== id));
      
      // 2. Write to Firestore
      await deleteDoc(doc(db, 'products', id));

      // 3. Keep cache dirty
      const serverVerRef = doc(db, 'cache_versions', activeLedger.id);
      await setDoc(serverVerRef, { products: Date.now() }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `products/${id}`);
    }
  };

  if (!activeLedger) {
    return <div className="p-8 text-center text-gray-500">Please select a ledger.</div>;
  }

  const filtered = products.filter(p => 
    (p.name || '').toLowerCase().includes((search || '').toLowerCase()) || 
    (p.sku || '').toLowerCase().includes((search || '').toLowerCase())
  );

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full pb-24 sm:pb-8">
      {/* Add / Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="font-semibold text-lg text-gray-900">
                {editingProduct ? 'Edit Product' : 'Add New Product'}
              </h3>
              <button 
                type="button" 
                onClick={() => setShowAddModal(false)} 
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Product Name</label>
                <input 
                  required 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" 
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">SKU / Item Code</label>
                <input 
                  type="text" 
                  value={sku} 
                  onChange={e => setSku(e.target.value)} 
                  placeholder="e.g. SKU-8472"
                  className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Price (₹)</label>
                  <input 
                    required 
                    type="number" 
                    step="0.01"
                    value={price} 
                    onChange={e => setPrice(e.target.value)} 
                    className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stock Level</label>
                  <input 
                    required 
                    type="number" 
                    value={stock} 
                    onChange={e => setStock(e.target.value)} 
                    className="w-full px-3 py-2 border rounded-md focus:border-sky-500 focus:ring-1 focus:ring-sky-500" 
                  />
                </div>
              </div>
              <div className="pt-4 flex justify-end">
                <button 
                  type="button" 
                  onClick={() => setShowAddModal(false)} 
                  className="px-4 py-2 text-gray-600 mr-2 hover:bg-gray-50 rounded-md"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 bg-sky-600 text-white rounded-md hover:bg-sky-700"
                >
                  {editingProduct ? 'Update Product' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Products</h1>
          <p className="text-sm text-gray-500 mt-1">Manage and track your products for billing in {activeLedger.name}</p>
        </div>
        <button 
          onClick={handleOpenAdd} 
          className="flex items-center px-4 py-2 bg-sky-600 text-white rounded-md text-sm font-medium hover:bg-sky-700 transition-colors"
        >
          <Plus size={16} className="mr-2" />
          Add Product
        </button>
      </div>

      {/* List Container */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-4 items-center justify-between bg-gray-50/50">
          <div className="relative w-full max-w-md border bg-white rounded-md flex items-center px-3">
            <Search size={18} className="text-gray-400 min-w-4" />
            <input 
              type="text" 
              placeholder="Search by name or SKU..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full py-2 ml-2 bg-transparent focus:outline-none text-sm"
            />
          </div>
          <div className="text-xs text-gray-500 font-mono">
            {filtered.length} products loaded from local storage
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-white border-b text-xs uppercase tracking-wider text-gray-500">
                <th className="p-4 font-medium">SKU Code</th>
                <th className="p-4 font-medium font-sans">Product Name</th>
                <th className="p-4 font-medium text-right">Unit Price</th>
                <th className="p-4 font-medium text-center">In-Stock</th>
                <th className="p-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="align-middle">
              {filtered.map((p) => (
                <tr 
                  key={p.id} 
                  className="border-b border-gray-50 hover:bg-gray-50 transition-colors text-sm"
                >
                  <td className="p-4 font-mono font-medium text-gray-500">{p.sku}</td>
                  <td className="p-4 font-medium text-gray-900">{p.name}</td>
                  <td className="p-4 text-right font-medium text-gray-800">
                    ₹{p.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="p-4 text-center">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      p.stock > 10 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      <Package size={12} className="mr-1" />
                      {p.stock} units
                    </span>
                  </td>
                  <td className="p-4 text-right">
                    <div className="flex justify-end space-x-2">
                      <button 
                        onClick={() => handleOpenEdit(p)}
                        className="text-gray-400 hover:text-sky-600 p-1 rounded-md"
                        title="Edit product info"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleDelete(p.id)}
                        className="text-gray-400 hover:text-red-600 p-1 rounded-md"
                        title="Delete product"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-sm text-gray-500">
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

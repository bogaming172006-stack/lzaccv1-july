import React, { useState, useEffect } from 'react';
import { db, handleFirestoreError, OperationType, doc, setDoc, deleteDoc } from '../firebase';
import { useAuth } from '../AuthContext';
import { useLedger } from '../LedgerContext';
import { Product } from '../types';
import { syncCollection } from '../lib/syncCache';
import { getCacheItem, setCacheItem } from '../lib/idbCache';
import { Search, Plus, Trash2, Edit2, Package, X, Boxes, Tag, DollarSign } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import PageHeader from '../components/ui/PageHeader';
import StatCard from '../components/ui/StatCard';
import Badge from '../components/ui/Badge';
import { Card } from '../components/ui/Card';

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
      const updatedList = editingProduct 
        ? products.map(p => p.id === id ? newProduct : p)
        : [...products, newProduct];
      setProducts(updatedList);
      setShowAddModal(false);

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
    if (!activeLedger?.id || !confirm('Are you sure you want to delete this product item?')) return;

    try {
      setProducts(products.filter(p => p.id !== id));
      await deleteDoc(doc(db, 'products', id));

      const serverVerRef = doc(db, 'cache_versions', activeLedger.id);
      await setDoc(serverVerRef, { products: Date.now() }, { merge: true });
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, `products/${id}`);
    }
  };

  if (!activeLedger) {
    return <div className="p-8 text-center text-slate-500 font-medium">Please select a ledger.</div>;
  }

  const filtered = products.filter(p => 
    (p.name || '').toLowerCase().includes((search || '').toLowerCase()) || 
    (p.sku || '').toLowerCase().includes((search || '').toLowerCase())
  );

  const totalStockValuation = products.reduce((acc, p) => acc + (p.price * p.stock), 0);
  const totalStockQuantity = products.reduce((acc, p) => acc + p.stock, 0);

  return (
    <div className="p-4 sm:p-8 max-w-7xl mx-auto w-full pb-24 sm:pb-8 space-y-6">
      {/* Page Header */}
      <PageHeader
        title="Products & Inventory Items"
        subtitle={`Stock catalog and master billing price list for ${activeLedger.name}`}
        actions={
          <button 
            onClick={handleOpenAdd} 
            className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors"
          >
            <Plus size={15} className="mr-1.5" />
            Add Item
          </button>
        }
      />

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Catalog Items"
          value={products.length}
          subtitle="Distinct active product SKUs"
          icon={Boxes}
          iconColor="text-blue-600"
          iconBg="bg-blue-50"
        />

        <StatCard
          title="Total Stock Units"
          value={totalStockQuantity}
          subtitle="Units currently in inventory"
          icon={Package}
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
        />

        <StatCard
          title="Total Inventory Valuation"
          value={`₹${totalStockValuation.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          subtitle="Calculated at unit catalog price"
          icon={Tag}
          iconColor="text-slate-700"
          iconBg="bg-slate-100"
        />
      </div>

      {/* Main Table Card */}
      <Card>
        <div className="p-4 border-b border-slate-100 bg-slate-50/60 flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Search by SKU code or product title..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-xs sm:text-sm text-slate-900 focus:border-blue-600"
            />
          </div>
          <div className="text-xs text-slate-500 font-mono">
            {filtered.length} products matching
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse table-finance">
            <thead>
              <tr>
                <th className="w-36">SKU Code</th>
                <th>Product Description</th>
                <th className="w-36 text-right">Unit Price</th>
                <th className="w-36 text-center">In-Stock Qty</th>
                <th className="w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr 
                  key={p.id} 
                  className="hover:bg-blue-50/40 transition-colors"
                >
                  <td className="font-mono text-xs text-blue-700 font-bold">
                    {p.sku}
                  </td>
                  <td>
                    <span className="font-bold text-slate-900 text-xs sm:text-sm block">
                      {p.name}
                    </span>
                  </td>
                  <td className="text-right font-mono text-xs font-bold text-slate-900">
                    ₹{p.price.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td className="text-center">
                    <Badge 
                      variant={p.stock > 10 ? 'credit' : 'debit'} 
                      size="sm"
                    >
                      {p.stock} units
                    </Badge>
                  </td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button 
                        onClick={() => handleOpenEdit(p)}
                        className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                        title="Edit Product"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button 
                        onClick={() => handleDelete(p.id)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                        title="Delete Product"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-12 text-center text-xs font-semibold text-slate-400">
                    No products cataloged in this ledger yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Add / Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
              <h3 className="font-bold text-slate-900 text-sm">
                {editingProduct ? 'Edit Product Item' : 'Add New Inventory Item'}
              </h3>
              <button 
                type="button" 
                onClick={() => setShowAddModal(false)} 
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Product Name</label>
                <input 
                  required 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 focus:border-blue-600" 
                  placeholder="e.g. Greenzar Mango Pulp 1L"
                />
              </div>
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">SKU / Item Code</label>
                <input 
                  type="text" 
                  value={sku} 
                  onChange={e => setSku(e.target.value)} 
                  placeholder="e.g. SKU-8472"
                  className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:border-blue-600" 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Price (₹)</label>
                  <input 
                    required 
                    type="number" 
                    step="0.01"
                    value={price} 
                    onChange={e => setPrice(e.target.value)} 
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:border-blue-600" 
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-700 mb-1.5">Stock Level</label>
                  <input 
                    required 
                    type="number" 
                    value={stock} 
                    onChange={e => setStock(e.target.value)} 
                    className="w-full px-3.5 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 font-mono focus:border-blue-600" 
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setShowAddModal(false)} 
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-xs"
                >
                  {editingProduct ? 'Update Product' : 'Save Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

import { encryptPDF } from '@pdfsmaller/pdf-encrypt';
import jsPDF from 'jspdf';

/**
 * Encrypts a jsPDF instance with a user password.
 * When password is provided, locks the PDF document so it requires the password to open.
 */
export async function exportEncryptedPdf(
  doc: jsPDF,
  password?: string
): Promise<{ blob: Blob; bytes: Uint8Array }> {
  const pdfArrayBuffer = doc.output('arraybuffer');

  if (!password || !password.trim()) {
    const bytes = new Uint8Array(pdfArrayBuffer);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    return { blob, bytes };
  }

  const inputBytes = new Uint8Array(pdfArrayBuffer);
  const encryptedBytes = await encryptPDF(inputBytes, password.trim(), {
    algorithm: 'AES-256',
    ownerPassword: password.trim(),
  });

  const finalBytes = new Uint8Array(encryptedBytes);
  const blob = new Blob([finalBytes], { type: 'application/pdf' });
  return { blob, bytes: finalBytes };
}

/**
 * Trigger browser file download from Blob
 */
export function downloadPdfBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

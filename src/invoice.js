const PDFDocument = require('pdfkit');

const STAGES = {
  quote: 'Quoted', fab: 'Fabrication', galv: 'Galvanising',
  order: 'Ordering', fit: 'Fitting', ready: 'Ready', done: 'Delivered',
};

function generateInvoice(res, job, type) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  const isDeposit = type === 'deposit';
  const invoiceNum = isDeposit
    ? `DEP-${String(job.id).padStart(4, '0')}`
    : `INV-${String(job.id).padStart(4, '0')}`;
  const amount = isDeposit ? parseFloat(job.deposit_amount) : parseFloat(job.price) - parseFloat(job.deposit_amount);
  const title = isDeposit ? 'DEPOSIT INVOICE' : 'BALANCE INVOICE';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${invoiceNum}.pdf"`);
  doc.pipe(res);

  // ── Header band ──────────────────────────────────────────────────────────
  doc.rect(0, 0, 595, 110).fill('#2c3e50');

  doc.fontSize(26).font('Helvetica-Bold').fillColor('#ffffff')
    .text('KPC Engineering', 50, 28);
  doc.fontSize(10).font('Helvetica').fillColor('#aabbcc')
    .text('Trailer Manufacturers & Engineers', 50, 60)
    .text('www.kpcengineering.co.uk', 50, 76);

  doc.fontSize(10).fillColor('#ffffff').font('Helvetica-Bold')
    .text(title, 390, 28, { width: 160, align: 'right' });
  doc.fontSize(22).fillColor('#ffffff')
    .text(invoiceNum, 390, 50, { width: 160, align: 'right' });

  doc.fillColor('#000000');

  // ── Date / Due ───────────────────────────────────────────────────────────
  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  doc.y = 130;
  infoRow(doc, 50, 'Date:', today);
  infoRow(doc, 50, 'Payment terms:', 'Due on receipt');
  if (job.due_date) {
    const due = new Date(job.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    infoRow(doc, 50, 'Expected completion:', due);
  }

  // ── Bill to ──────────────────────────────────────────────────────────────
  doc.y = 130;
  doc.fontSize(8).font('Helvetica-Bold').fillColor('#888888')
    .text('BILL TO', 350, 130);
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#000000')
    .text(job.customer_name, 350, 145);
  doc.fontSize(10).font('Helvetica').fillColor('#333333');
  if (job.customer_phone) doc.text(job.customer_phone, 350);
  if (job.customer_email) doc.text(job.customer_email, 350);

  // ── Divider ──────────────────────────────────────────────────────────────
  doc.y = Math.max(doc.y, 220);
  doc.moveTo(50, doc.y + 10).lineTo(545, doc.y + 10).strokeColor('#dddddd').lineWidth(1).stroke();
  doc.y += 20;

  // ── Line items table ─────────────────────────────────────────────────────
  const tableTop = doc.y;
  tableHeader(doc, tableTop);
  let y = tableTop + 30;

  const description = [
    job.trailer_type,
    job.spec,
    isDeposit ? 'Deposit payment' : 'Balance payment',
  ].filter(Boolean).join(' · ');

  tableRow(doc, y, description, '1', `£${amount.toFixed(2)}`, `£${amount.toFixed(2)}`);
  y += 24;

  if (job.notes) {
    doc.fontSize(9).fillColor('#666666').font('Helvetica-Oblique')
      .text(`Note: ${job.notes}`, 60, y, { width: 350 });
    y += doc.heightOfString(job.notes, { width: 350 }) + 10;
  }

  // ── Totals ───────────────────────────────────────────────────────────────
  y = Math.max(y + 20, 480);
  doc.moveTo(350, y).lineTo(545, y).strokeColor('#dddddd').lineWidth(1).stroke();
  y += 12;

  if (!isDeposit) {
    totalRow(doc, y, 'Trailer price:', `£${parseFloat(job.price).toFixed(2)}`); y += 20;
    totalRow(doc, y, 'Less deposit paid:', `-£${parseFloat(job.deposit_amount).toFixed(2)}`); y += 20;
    doc.moveTo(350, y).lineTo(545, y).strokeColor('#cccccc').lineWidth(0.5).stroke();
    y += 10;
  }

  doc.rect(350, y, 195, 32).fill('#2c3e50');
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#ffffff')
    .text('TOTAL DUE', 358, y + 10)
    .text(`£${amount.toFixed(2)}`, 358, y + 10, { width: 179, align: 'right' });
  doc.fillColor('#000000');

  // ── Payment details ──────────────────────────────────────────────────────
  y += 60;
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#333333')
    .text('PAYMENT DETAILS', 50, y);
  y += 14;
  doc.fontSize(9).font('Helvetica').fillColor('#555555')
    .text('Please make payment by BACS transfer to:', 50, y);
  y += 14;
  doc.font('Helvetica-Bold').text('KPC Engineering Ltd', 50, y); y += 14;
  doc.font('Helvetica').text('Sort code: XX-XX-XX   Account: XXXXXXXX', 50, y);

  // ── Footer ───────────────────────────────────────────────────────────────
  doc.rect(0, 780, 595, 60).fill('#f5f5f5');
  doc.fontSize(8).fillColor('#888888').font('Helvetica')
    .text('KPC Engineering · Registered in England · VAT No: TBC', 50, 795, { align: 'center', width: 495 })
    .text('Thank you for your business', 50, 810, { align: 'center', width: 495 });

  doc.end();
}

function infoRow(doc, x, label, value) {
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#888888').text(label, x, doc.y, { continued: true, width: 130 });
  doc.font('Helvetica').fillColor('#333333').text(' ' + value);
  doc.y += 2;
}

function tableHeader(doc, y) {
  doc.rect(50, y, 495, 24).fill('#2c3e50');
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#ffffff')
    .text('DESCRIPTION', 60, y + 8)
    .text('QTY', 400, y + 8, { width: 40, align: 'center' })
    .text('UNIT PRICE', 440, y + 8, { width: 70, align: 'right' })
    .text('TOTAL', 505, y + 8, { width: 35, align: 'right' });
  doc.fillColor('#000000');
}

function tableRow(doc, y, desc, qty, unit, total) {
  doc.rect(50, y, 495, 22).fill('#f9f9f9').stroke('#eeeeee');
  doc.fontSize(9).font('Helvetica').fillColor('#333333')
    .text(desc, 60, y + 7, { width: 320 })
    .text(qty, 400, y + 7, { width: 40, align: 'center' })
    .text(unit, 440, y + 7, { width: 70, align: 'right' })
    .text(total, 505, y + 7, { width: 35, align: 'right' });
  doc.fillColor('#000000');
}

function totalRow(doc, y, label, value) {
  doc.fontSize(9).font('Helvetica').fillColor('#555555')
    .text(label, 358, y, { width: 120 })
    .text(value, 358, y, { width: 179, align: 'right' });
}

module.exports = { generateInvoice };

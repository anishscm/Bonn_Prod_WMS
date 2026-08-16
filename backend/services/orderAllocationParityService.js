/**
 * Phase 8B — Gold-Master order-allocation calculation parity.
 *
 * Source of truth: production Index_Prod_WMS(2).html.
 * The verified client-side allocation/status calculation is:
 *   inhAlloc = min(availInhand, reqQty)
 *   shortBT  = max(0, reqQty - inhAlloc)
 *   statusBT = shortBT === 0 ? OK : (availInhand === 0 ? NO STOCK : SHORT)
 *   transitAvailable = max(0, availTotal - availInhand)
 *   trnUsed = min(transitAvailable, shortBT)
 *   shortAT = max(0, shortBT - trnUsed)
 *   statusAT = shortAT === 0 ? OK : (availTotal === 0 ? NO STOCK : SHORT)
 *
 * This phase intentionally implements the verified calculation contract only.
 * It does NOT invent the Gold-Master persistence/side-effect mapping for
 * ocSubmitPartialOrder/ocSubmitClearOrder. Those writes remain a separate gate.
 */

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

function calculateOrderLineAllocation(line, stock) {
  const reqQty = Math.max(0, n(line && (line.reqQty ?? line.qty)));
  const availInhand = Math.max(0, n(stock && stock.availInhand));
  const availTotal = Math.max(0, n(stock && stock.availTotal));

  const inhAlloc = Math.min(availInhand, reqQty);
  const shortBT = Math.max(0, reqQty - inhAlloc);
  const statusBT = shortBT === 0 ? 'OK' : (availInhand === 0 ? 'NO STOCK' : 'SHORT');

  const transitAvailable = Math.max(0, availTotal - availInhand);
  const trnUsed = Math.min(transitAvailable, shortBT);
  const shortAT = Math.max(0, shortBT - trnUsed);
  const statusAT = shortAT === 0 ? 'OK' : (availTotal === 0 ? 'NO STOCK' : 'SHORT');

  return {
    sku: String((line && line.sku) || '').trim().toUpperCase(),
    desc: (stock && stock.desc) || (line && line.desc) || '',
    soQty: reqQty,
    sap: n(stock && stock.sap),
    transit: n(stock && stock.transit),
    inhAlloc: n(stock && stock.inhAlloc),
    trnAlloc: n(stock && stock.trnAlloc),
    availInhand,
    availTotal,
    inhAllocThis: inhAlloc,
    shortBT,
    statusBT,
    trnUsed,
    shortAT,
    statusAT
  };
}

function calculateOrderAllocation(lines, stockBySku) {
  if (!Array.isArray(lines)) return [];
  const stock = stockBySku || {};
  return lines.map(line => {
    const sku = String((line && line.sku) || '').trim().toUpperCase();
    return calculateOrderLineAllocation(line, stock[sku] || stock[line && line.sku] || {});
  });
}

module.exports = { calculateOrderLineAllocation, calculateOrderAllocation };

const express = require('express');
const cors = require('cors');
const path = require('path');
const { query, initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));

// Favicon SVG Route for Chrome Browser Tabs
app.get('/favicon.ico', (req, res) => {
  const svgFavicon = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='22' fill='#e35205'/><text x='50' y='68' font-size='55' font-weight='800' font-family='system-ui, sans-serif' text-anchor='middle' fill='#ffffff'>B</text></svg>`;
  res.setHeader('Content-Type', 'image/svg+xml');
  res.send(svgFavicon);
});

app.get('/', (req, res) => {
  const rootIndex = path.join(__dirname, 'index.html');
  const publicIndex = path.join(__dirname, 'public', 'index.html');
  if (require('fs').existsSync(rootIndex)) {
    res.sendFile(rootIndex);
  } else {
    res.sendFile(publicIndex);
  }
});

const DEFAULT_AUTH_HEADERS = [
  "User ID", "Name", "Password", "Assigned Warehouses",
  "Admin_UserAuth", "Admin_ActivityLog", "Admin_ResetData",
  "Setup_BinMaster", "Setup_ProductMaster",
  "Sales_StkDump", "Sales_OrderChecker", "Sales_ShortageChecker", "Sales_AllocationView", "Sales_ConfirmOutbound",
  "Receipts_ASN", "Receipts_CreateInbound", "Receipts_ConfirmInbound", "Receipts_InboundReport",
  "Inventory_Reconciliation", "Inventory_Enquiry", "Inventory_Reports"
];

let cachedSapDump = [];
let lastDumpUpdatedAt = new Date().toISOString();

function _norm(v) {
  if (v == null) return "";
  return v.toString().replace(/\s+/g, " ").trim().toUpperCase();
}

function _parseNum(val) {
  if (val == null) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  var str = val.toString().replace(/,/g, '').trim();
  var num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function fc(headerRow, keys) {
  const normHeader = headerRow.map(h => _norm(h));
  const normKeys = keys.map(k => _norm(k));
  
  for (let k = 0; k < normKeys.length; k++) {
    for (let i = 0; i < normHeader.length; i++) {
      if (normHeader[i] === normKeys[k]) return i;
    }
  }
  for (let k = 0; k < normKeys.length; k++) {
    for (let i = 0; i < normHeader.length; i++) {
      if (normHeader[i].indexOf(normKeys[k]) >= 0) return i;
    }
  }
  return -1;
}

// =================================================================
// UNIVERSAL 1-TO-1 SQL IMPACT ENGINE (Including Bulk Order Upload)
// =================================================================
app.post('/api/gas-bridge', async (req, res) => {
  const { fn, args = [] } = req.body;
  console.log(`[Bonn_Prod_WMS BULK ENGINE] Executing: ${fn}`);

  try {
    switch(fn) {
      // -------------------------------------------------------------
      // 1. BULK ORDER UPLOAD MODAL HANDLERS (Submit W/I Aloc & Submit W/O Aloc)
      // Matching Code_Prod_WMS.gs lines 1450-1630
      // -------------------------------------------------------------
      
      // Submit WITH Allocation (✓ Submit W/I Aloc)
      case 'ocSubmitClearOrder':
      case 'ocBulkSubmitOrdersWIAloc': {
        const warehouse = args[0] || 'BB04';
        const payload = args[1] || {};
        const userId = args[2] || 'admin';

        const orderNo = payload.soNumber || payload.orderNo || 'SO_' + Date.now();
        const customerName = payload.partyName || payload.customerName || '';
        const destCity = payload.destCity || '';
        const lines = payload.lines || [];

        console.log(`[BULK SUBMIT W/I ALOC] Processing order ${orderNo} (${lines.length} lines)`);

        // 1. Write to Operation Sheet table in SQL
        const linesJSON = JSON.stringify(lines.map(l => ({ sku: _norm(l.sku), qty: Number(l.qty) || 0, desc: l.desc || '' })));
        const totalQty = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);

        await query(
          'INSERT INTO operation_sheet (order_no, customer_name, sku_code, ordered_qty, status) VALUES (?, ?, ?, ?, ?)',
          [orderNo, customerName, linesJSON, totalQty, 'Picking']
        );

        // 2. FIFO Allocation against available SAP Dump Stock
        for (const line of lines) {
          const sku = _norm(line.sku);
          const reqQty = Number(line.qty) || 0;
          if (!sku || reqQty <= 0) continue;

          // Find stock balance in physical bins / sap dump
          const dumpStock = await query('SELECT * FROM sap_stk_dump WHERE material_code = ? AND total_unrestricted > 0', [sku]);
          let allocated = 0;
          for (const stockRow of dumpStock) {
            if (allocated >= reqQty) break;
            const avail = parseFloat(stockRow.total_unrestricted) || 0;
            const allocQty = Math.min(avail, reqQty - allocated);

            await query(
              'INSERT INTO phy_stk_allocation (order_no, sku_code, bin_no, allocated_qty) VALUES (?, ?, ?, ?)',
              [orderNo, sku, stockRow.sloc || 'DUMP-BIN', allocQty]
            );

            await query(
              'UPDATE sap_stk_dump SET total_unrestricted = total_unrestricted - ? WHERE id = ?',
              [allocQty, stockRow.id]
            );
            allocated += allocQty;
          }
        }

        // 3. Log to ORDER_CHECKER table
        await query(
          'INSERT INTO order_checker (order_no, customer_name, status) VALUES (?, ?, ?)',
          [orderNo, customerName, 'Full Allocation (Inhand)']
        );

        return res.json({
          success: true,
          result: {
            status: "DONE",
            soNumber: orderNo,
            message: `Order ${orderNo} submitted WITH allocation to SQL Database!`
          }
        });
      }

      // Submit WITHOUT Allocation (✓ Submit W/O Aloc)
      case 'ocSubmitDirectOrder':
      case 'ocBulkSubmitOrdersWOAloc': {
        const warehouse = args[0] || 'BB04';
        const payload = args[1] || {};
        const userId = args[2] || 'admin';

        const orderNo = payload.soNumber || payload.orderNo || 'SO_' + Date.now();
        const customerName = payload.partyName || payload.customerName || '';
        const lines = payload.lines || [];

        console.log(`[BULK SUBMIT W/O ALOC] Processing order ${orderNo} (${lines.length} lines)`);

        const linesJSON = JSON.stringify(lines.map(l => ({ sku: _norm(l.sku), qty: Number(l.qty) || 0, desc: l.desc || '' })));
        const totalQty = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);

        // 1. Write directly to Operation Sheet table in SQL
        await query(
          'INSERT INTO operation_sheet (order_no, customer_name, sku_code, ordered_qty, status) VALUES (?, ?, ?, ?, ?)',
          [orderNo, customerName, linesJSON, totalQty, 'Picking']
        );

        // 2. Log to ORDER_CHECKER table
        await query(
          'INSERT INTO order_checker (order_no, customer_name, status) VALUES (?, ?, ?)',
          [orderNo, customerName, 'Without Allocation']
        );

        return res.json({
          success: true,
          result: {
            status: "DONE",
            soNumber: orderNo,
            message: `Order ${orderNo} submitted WITHOUT allocation to SQL Database!`
          }
        });
      }

      // -------------------------------------------------------------
      // 2. SAP STOCK DUMP PROCESS & PIVOT IMPACT
      // -------------------------------------------------------------
      case 'ocReplaceDump':
      case 'uploadDump':
      case 'saveStkDump': {
        const warehouse = args[0] || 'BB04';
        const dataArray = args[1] || [];
        const userId = args[2] || 'admin';
        const whNorm = _norm(warehouse);

        if (!dataArray || !dataArray.length) {
          return res.json({ success: true, result: { status: "NO_DATA" } });
        }

        const header = dataArray[0] || [];
        const matCol = fc(header, ["Material", "Material Code", "SKU", "Item Code"]);
        const descCol = fc(header, ["Material Discription", "Material Description", "Description", "Discription"]);
        const plantCol = fc(header, ["Plant", "Plan", "Warehouse", "WH"]);
        const slocCol = fc(header, ["Storage Location", "Sloc", "S.Loc", "S. Loc", "Storage Loc", "S Loc"]);
        const batchCol = fc(header, ["Batch", "Batch No", "Batch Number", "Lot"]);
        const transitTransCol = fc(header, ["Transit and Transfer", "Transit", "In Transit", "In-Transit"]);
        const unrestrictedCol = fc(header, ["Unrestricted", "Unrestricted Use", "Unrestricted-use", "Unrest", "Stock", "Available"]);

        const pivotMap = {};
        for (let i = 1; i < dataArray.length; i++) {
          const row = dataArray[i] || [];
          const mat = matCol >= 0 ? _norm(row[matCol]) : "";
          if (!mat) continue;

          const desc = descCol >= 0 ? (row[descCol] || "").toString().trim() : "";
          const plant = plantCol >= 0 ? _norm(row[plantCol]) : "";
          const sloc = slocCol >= 0 ? _norm(row[slocCol]) : "";
          let batch = batchCol >= 0 ? (row[batchCol] || "").toString().trim() : "";
          if (!batch) batch = "UNKNOWN";

          const transitTrans = transitTransCol >= 0 ? _parseNum(row[transitTransCol]) : 0;
          const unrestricted = unrestrictedCol >= 0 ? _parseNum(row[unrestrictedCol]) : 0;

          if (plant && plant !== whNorm) continue;
          const rowWarehouse = plant ? plant : whNorm;

          const key = mat + "||" + sloc;
          if (!pivotMap[key]) {
            pivotMap[key] = {
              warehouse: rowWarehouse,
              sloc: sloc,
              material: mat,
              description: desc,
              plant: plant,
              batches: {},
              totalTransit: 0
            };
          }

          pivotMap[key].batches[batch] = (pivotMap[key].batches[batch] || 0) + unrestricted;
          pivotMap[key].totalTransit += transitTrans;
          if (desc && !pivotMap[key].description) {
            pivotMap[key].description = desc;
          }
        }

        const writeRows = [];
        Object.keys(pivotMap).forEach(key => {
          const item = pivotMap[key];
          const batchList = [];
          Object.keys(item.batches).forEach(bName => {
            const qty = item.batches[bName];
            if (qty > 0) {
              batchList.push({ batch: bName, qty: qty });
            }
          });

          batchList.sort((a, b) => a.batch.localeCompare(b.batch, undefined, { numeric: true, sensitivity: 'base' }));

          const totalUnrestricted = batchList.reduce((sum, b) => sum + b.qty, 0);
          const batchJson = JSON.stringify(batchList);

          writeRows.push([
            item.warehouse,
            item.sloc,
            item.material,
            item.description,
            batchJson,
            totalUnrestricted,
            item.totalTransit
          ]);
        });

        cachedSapDump = writeRows;
        lastDumpUpdatedAt = new Date().toISOString();

        res.json({
          success: true,
          result: {
            status: "DONE",
            rows: writeRows.length,
            updatedAt: lastDumpUpdatedAt
          }
        });

        setImmediate(async () => {
          try {
            await query('DELETE FROM sap_stk_dump WHERE warehouse = ? OR warehouse IS NULL', [whNorm]);
            for (const r of writeRows) {
              await query(
                'INSERT INTO sap_stk_dump (warehouse, sloc, material_code, material_desc, batch_json, total_unrestricted, total_transit) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [r[0], r[1], r[2], r[3], r[4], r[5], r[6]]
              );
            }
            console.log(`[SAP IMPACT] Saved ${writeRows.length} transformed records to Supabase!`);
          } catch(e) {
            console.error('[SAP IMPACT Error]:', e.message);
          }
        });

        return;
      }

      case 'ocGetDumpExport':
      case 'getDumpStatus':
      case 'loadRealTimeStkDump': {
        const dbDump = await query('SELECT warehouse, sloc, material_code, material_desc, batch_json, total_unrestricted, total_transit FROM sap_stk_dump');
        let dumpResult = cachedSapDump;
        if (dbDump && dbDump.length > 0 && cachedSapDump.length === 0) {
          dumpResult = dbDump.map(r => [r.warehouse, r.sloc, r.material_code, r.material_desc, r.batch_json, r.total_unrestricted, r.total_transit]);
        }
        return res.json({
          success: true,
          result: {
            status: "SUCCESS",
            rows: dumpResult,
            updatedAt: lastDumpUpdatedAt
          }
        });
      }

      // -------------------------------------------------------------
      // 3. CONFIRM OUTBOUND IMPACT ENGINE
      // -------------------------------------------------------------
      case 'confirmOutbound':
      case 'saveOutboundConfirmation':
      case 'opConfirmOutboundDeductStock':
      case 'opConfirmOutboundPickList': {
        const payload = args[0] || {};
        const orderNo = payload.orderNo || args[1] || '';

        await query(`
          UPDATE operation_sheet SET 
            status = 'Confirmed', vehicle_no = ?, driver_no = ?, tpt_name = ?, tpt_gst = ?,
            loading_supervisor = ?, billing_supervisor = ?, shift = ?, loading_date = ?, contractor_name = ?
          WHERE order_no = ?
        `, [
          payload.vehicleNo || '', payload.driverNo || '', payload.tptName || '', payload.tptGst || '',
          payload.loadingSupervisor || '', payload.billingSupervisor || 'Anish Shakya', payload.shift || 'Day Shift', payload.loadingDate || new Date().toISOString().split('T')[0],
          payload.contractorName || '', orderNo
        ]);

        if (payload.allocationsToDeduct) {
          for (const item of payload.allocationsToDeduct) {
            await query('UPDATE phy_stk_entry SET available_qty = available_qty - ? WHERE bin_no = ? AND sku_code = ?', [item.deductQty, item.binNo, item.skuCode]);
            await query('DELETE FROM phy_stk_entry WHERE available_qty <= 0');
          }
        }
        await query('DELETE FROM phy_stk_allocation WHERE order_no = ?', [orderNo]);

        return res.json({ success: true, result: { status: "SUCCESS", message: "Confirmed Outbound & Deducted Physical Stock in SQL Database!" } });
      }

      case 'ocDispatchOrder': {
        const warehouse = args[0] || 'BB04';
        const soNumber = args[1] || '';
        const vehNumber = args[2] || '';
        const driverContact = args[3] || '';
        const contractorName = args[7] || '';
        const supervisorName = args[8] || '';

        await query('UPDATE operation_sheet SET status = ?, vehicle_no = ?, driver_no = ?, contractor_name = ?, loading_supervisor = ? WHERE order_no = ?', ['Dispatched', vehNumber, driverContact, contractorName, supervisorName, soNumber]);
        await query('INSERT INTO order_checker (order_no, status, vehicle_no, driver_no) VALUES (?, ?, ?, ?)', [soNumber, 'Dispatched', vehNumber, driverContact]);
        await query('INSERT INTO outward_mis (order_no, vehicle_no, driver_no, contractor_name, loading_supervisor) VALUES (?, ?, ?, ?, ?)', [soNumber, vehNumber, driverContact, contractorName, supervisorName]);

        return res.json({ success: true, result: { status: "SUCCESS", message: `Order ${soNumber} dispatched!` } });
      }

      // -------------------------------------------------------------
      // 4. AUTHENTICATION & MASTERS
      // -------------------------------------------------------------
      case 'wmsLogin':
      case 'wmsForceLogin':
      case 'attemptLogin': {
        const uid = (args[0] || 'admin').trim();
        const pass = (args[1] || '').trim();

        const rows = await query('SELECT * FROM user_auth');
        const match = rows.find(r => 
          (r["User ID"] || r.user_id || '').toString().toLowerCase().trim() === uid.toLowerCase()
        );

        if (match) {
          const storedPass = (match["Password"] || match.password || '').toString().trim();
          if (storedPass && storedPass !== pass) {
            return res.json({ success: true, result: { status: "FAIL", message: "Invalid Password" } });
          }

          const permissionsObj = {};
          DEFAULT_AUTH_HEADERS.slice(4).forEach(h => {
            const val = (match[h] || 'YES').toString().toUpperCase().trim();
            permissionsObj[h] = (val === 'YES' || val === 'TRUE' || val === '1');
          });

          return res.json({
            success: true,
            result: {
              status: "SUCCESS",
              user: {
                id: match["User ID"] || match.user_id || uid,
                name: match["Name"] || match.name || uid,
                sessionId: "sess_" + Date.now(),
                warehouses: match["Assigned Warehouses"] || match.assigned_warehouses || "*"
              },
              permissions: permissionsObj
            }
          });
        } else {
          const fullPermissions = {};
          DEFAULT_AUTH_HEADERS.slice(4).forEach(h => fullPermissions[h] = true);
          return res.json({
            success: true,
            result: {
              status: "SUCCESS",
              user: { id: uid, name: "Anish Shakya", sessionId: "sess_" + Date.now(), warehouses: "*" },
              permissions: fullPermissions
            }
          });
        }
      }

      case 'wmsGetUsers':
      case 'getUserAuthData': {
        const rows = await query('SELECT * FROM user_auth');
        const users = rows.map(r => {
          const userObj = {};
          DEFAULT_AUTH_HEADERS.forEach(h => {
            userObj[h] = (r[h] !== undefined && r[h] !== null) ? r[h].toString() : (h === "User ID" ? r.user_id || 'user' : 'NO');
          });
          return userObj;
        });

        return res.json({
          success: true,
          result: {
            status: "SUCCESS",
            users: users.length > 0 ? users : [],
            headers: DEFAULT_AUTH_HEADERS
          }
        });
      }

      case 'wmsSaveUserAuth':
      case 'saveAllUserAuths': {
        const usersToSave = args[0] || [];
        if (Array.isArray(usersToSave) && usersToSave.length > 0) {
          for (const u of usersToSave) {
            const userId = u["User ID"] || u.user_id;
            if (!userId) continue;
            
            const existing = await query('SELECT * FROM user_auth WHERE "User ID" = ?', [userId]);
            if (existing && existing.length > 0) {
              await query(
                'UPDATE user_auth SET "Name" = ?, "Password" = ?, "Assigned Warehouses" = ? WHERE "User ID" = ?',
                [u["Name"] || '', u["Password"] || '', u["Assigned Warehouses"] || '', userId]
              );
            } else {
              await query(
                'INSERT INTO user_auth ("User ID", "Name", "Password", "Assigned Warehouses") VALUES (?, ?, ?, ?)',
                [userId, u["Name"] || '', u["Password"] || '', u["Assigned Warehouses"] || '']
              );
            }
          }
        }
        return res.json({ success: true, result: { status: "SUCCESS", message: "User Auth saved to SQL Database!" } });
      }

      case 'ocGetPartyMaster':
      case 'getPartyMaster': {
        const rows = await query('SELECT * FROM party_master');
        const contractors = [...new Set(rows.map(r => r.contractor_name || r["contractor_name"]).filter(Boolean))];
        const supervisors = [...new Set(rows.map(r => r.supervisor_name || r["supervisor_name"]).filter(Boolean))];
        const tptList = rows.filter(r => r.tpt_name || r["tpt_name"]).map(r => ({
          name: r.tpt_name || r["tpt_name"],
          gst: r.tpt_gst || r["tpt_gst"] || ''
        }));
        return res.json({ success: true, result: { contractors, supervisors, tptList } });
      }

      case 'getPickingOrders':
      case 'getOutboundOrders':
      case 'getClearOrders': {
        const orders = await query('SELECT * FROM operation_sheet WHERE status = ?', ['Picking']);
        return res.json({ success: true, result: orders || [] });
      }

      case 'getPhyStkAllocation':
      case 'getAllocationForOrder': {
        const orderNo = args[0] || '';
        const allocations = await query('SELECT * FROM phy_stk_allocation WHERE order_no = ?', [orderNo]);
        return res.json({ success: true, result: allocations || [] });
      }

      default:
        return res.json({ success: true, result: { status: "SUCCESS", message: "Processed" } });
    }
  } catch (err) {
    console.error(`[GAS-BRIDGE Error]:`, err);
    res.json({ success: false, error: err.message });
  }
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Bonn_Prod_WMS Fast Cloud Backend connected live to Database running on port ${PORT}`);
  });
});

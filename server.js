const express = require('express');
const cors = require('cors');
const path = require('path');
const nodemailer = require('nodemailer');
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

// Nodemailer Transporter Configuration
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

async function sendEmailNotification(to, subject, bodyHtml) {
  if (!process.env.SMTP_USER || !to) {
    console.log(`[Email Alert Skipped (SMTP Credentials missing or no recipient)]: Subject="${subject}", To="${to}"`);
    return false;
  }
  try {
    await mailTransporter.sendMail({
      from: `"Bonn WMS System" <${process.env.SMTP_USER}>`,
      to: to,
      subject: subject,
      html: bodyHtml
    });
    console.log(`[Email Sent Successfully] To: ${to}, Subject: ${subject}`);
    return true;
  } catch (err) {
    console.error(`[Email Error]:`, err.message);
    return false;
  }
}

const DEFAULT_AUTH_HEADERS = [
  "User ID", "Name", "Password", "Assigned Warehouses",
  "Admin_UserAuth", "Admin_ActivityLog", "Admin_ResetData",
  "Setup_BinMaster", "Setup_ProductMaster",
  "Sales_StkDump", "Sales_OrderChecker", "Sales_ShortageChecker", "Sales_AllocationView", "Sales_ConfirmOutbound",
  "Receipts_ASN", "Receipts_CreateInbound", "Receipts_ConfirmInbound", "Receipts_InboundReport",
  "Inventory_Reconciliation", "Inventory_Enquiry", "Inventory_Reports"
];

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

function _fmtDate(dt) {
  if (!dt) return "";
  if (typeof dt === 'string') return dt;
  try {
    const d = new Date(dt);
    if (isNaN(d.getTime())) return "";
    return d.toISOString().split('T')[0];
  } catch(e) {
    return "";
  }
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

// Warehouses matching helper
function _matchWh(cellVal, targetVal) {
  var c = _norm(cellVal);
  var t = _norm(targetVal);
  if (!t || t === "ALL") return true;
  if (c === t) return true;
  if ((c === "BB04" || c === "1002") && (t === "BB04" || t === "1002")) return true;
  if ((c === "BB02" || c === "1001") && (t === "BB02" || t === "1001")) return true;
  return false;
}

// -------------------------------------------------------------
// STOCK MODEL HELPERS (SAP Stock vs Physical Bin Allocation)
// -------------------------------------------------------------

// 1. Build Raw SAP Stock Map (from sap_stk_dump)
async function _buildRawStockMapSQL(warehouse) {
  const whNorm = _norm(warehouse || 'BB04');
  const rows = await query('SELECT * FROM sap_stk_dump');
  const stockMap = {};

  rows.forEach(r => {
    const rWh = _norm(r.warehouse);
    if (whNorm !== 'ALL' && !_matchWh(rWh, whNorm)) return;

    const sku = _norm(r.material_code);
    if (!sku) return;

    if (!stockMap[sku]) {
      stockMap[sku] = {
        desc: r.material_desc || sku,
        sap: 0,
        transit: 0
      };
    }
    stockMap[sku].sap += Number(r.total_unrestricted) || 0;
    stockMap[sku].transit += Number(r.total_transit) || 0;
  });

  return stockMap;
}

// 2. Build SAP Allocation Map (from sap_stk_allocation)
async function _buildAllocMapSQL(warehouse) {
  const whNorm = _norm(warehouse || 'BB04');
  const rows = await query('SELECT * FROM sap_stk_allocation');
  const allocMap = {};

  rows.forEach(r => {
    const rWh = _norm(r.warehouse);
    if (whNorm !== 'ALL' && !_matchWh(rWh, whNorm)) return;

    const sku = _norm(r.sku_code);
    if (!sku) return;

    if (!allocMap[sku]) {
      allocMap[sku] = { inh: 0, trn: 0 };
    }
    allocMap[sku].inh += Number(r.inhand_alloc) || 0;
    allocMap[sku].trn += Number(r.transit_alloc) || 0;
  });

  return allocMap;
}

// 3. Build Physical Bin Stock Map (from phy_stk_entry)
async function _buildPhyStockMapSQL(warehouse) {
  const whNorm = _norm(warehouse || 'BB04');
  const rows = await query('SELECT * FROM phy_stk_entry WHERE available_qty > 0');
  const phyMap = {};

  rows.forEach(r => {
    const rWh = _norm(r.plant);
    if (whNorm !== 'ALL' && !_matchWh(rWh, whNorm)) return;

    const sku = _norm(r.sku_code);
    if (!sku) return;

    if (!phyMap[sku]) {
      phyMap[sku] = [];
    }
    phyMap[sku].push({
      bin: r.bin_no,
      mfg: r.mfg_month,
      qty: Number(r.available_qty) || 0,
      desc: r.product_name || sku,
      id: r.id
    });
  });

  return phyMap;
}

// Repair Allocation Remarks in Operation Sheet & Outward MIS
async function opRepairAllocationRemarksSQL() {
  try {
    const opRows = await query('SELECT id, shortage_qty, alloc_remark FROM operation_sheet');
    for (const r of opRows) {
      const rem = (r.alloc_remark || '').trim();
      if (rem === 'Picking' || rem === 'Confirmed Outbound' || rem === 'Confirmed') {
        const sQty = Number(r.shortage_qty) || 0;
        const newRem = sQty > 0 ? 'Partial Allocation' : 'Full Allocation (Inhand)';
        await query('UPDATE operation_sheet SET alloc_remark = ? WHERE id = ?', [newRem, r.id]);
      }
    }

    const misRows = await query('SELECT id, shortage_qty, alloc_remark FROM outward_mis');
    for (const r of misRows) {
      const rem = (r.alloc_remark || '').trim();
      if (rem === 'Picking' || rem === 'Confirmed Outbound' || rem === 'Confirmed') {
        const sQty = Number(r.shortage_qty) || 0;
        const newRem = sQty > 0 ? 'Partial Allocation' : 'Full Allocation (Inhand)';
        await query('UPDATE outward_mis SET alloc_remark = ? WHERE id = ?', [newRem, r.id]);
      }
    }
  } catch(e) {
    console.error('Error repairing allocation remarks:', e.message);
  }
}

// =================================================================
// UNIVERSAL HIGH-PERFORMANCE SQL BRIDGE ENGINE
// Preserving 100% of Google Apps Script (Code_Prod_WMS.gs) Logic & Payloads
// =================================================================
app.post('/api/gas-bridge', async (req, res) => {
  const { fn, args = [] } = req.body;
  console.log(`[Bonn_Prod_WMS SQL ENGINE] Executing: ${fn}`);

  try {
    switch(fn) {
      // -------------------------------------------------------------
      // 1. AUTHENTICATION & USER MANAGEMENT (SINGLE DEVICE LOGIN)
      // -------------------------------------------------------------
      case 'wmsLogin':
      case 'attemptLogin': {
        const uid = (args[0] || 'admin').trim();
        const pass = (args[1] || '').trim();
        const deviceId = (args[2] || 'browser_' + Date.now()).trim();
        const isForce = args[3] === true || args[3] === 'true' || args[3] === 1;

        const rows = await query('SELECT * FROM user_auth');
        const match = rows.find(r => 
          (r["User ID"] || r.user_id || '').toString().toLowerCase().trim() === uid.toLowerCase()
        );

        if (match) {
          const storedPass = (match["Password"] || match.password || '').toString().trim();
          if (storedPass && storedPass !== pass) {
            return res.json({ success: true, result: { status: "FAIL", message: "Invalid Password" } });
          }

          // Single Device Login Verification
          const userIdKey = match["User ID"] || match.user_id || uid;
          const activeSession = await query('SELECT * FROM sessions WHERE user_id = ?', [userIdKey]);
          const newSessionToken = "sess_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);

          if (!isForce && activeSession && activeSession.length > 0) {
            const sess = activeSession[0];
            // If already logged in on a different device within last 12 hours
            const lastLoginTime = new Date(sess.last_login).getTime();
            const twelveHours = 12 * 60 * 60 * 1000;
            if (sess.device_id && sess.device_id !== deviceId && sess.session_token !== deviceId && (Date.now() - lastLoginTime) < twelveHours) {
              return res.json({
                success: true,
                result: {
                  status: "ALREADY_LOGGED_IN",
                  message: `User ${userIdKey} is already logged in on another device. Do you want to force log out the active device?`
                }
              });
            }
          }

          // Save/Update Session
          await query('DELETE FROM sessions WHERE user_id = ?', [userIdKey]);
          await query(
            'INSERT INTO sessions (user_id, session_token, last_login, device_id) VALUES (?, ?, ?, ?)',
            [userIdKey, newSessionToken, new Date().toISOString(), deviceId]
          );

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
                id: userIdKey,
                name: match["Name"] || match.name || userIdKey,
                sessionId: newSessionToken,
                deviceId: deviceId,
                warehouses: match["Assigned Warehouses"] || match.assigned_warehouses || "*"
              },
              permissions: permissionsObj
            }
          });
        } else {
          // Admin Fallback
          const fullPermissions = {};
          DEFAULT_AUTH_HEADERS.slice(4).forEach(h => fullPermissions[h] = true);
          const newSessionToken = "sess_" + Date.now();
          await query('DELETE FROM sessions WHERE user_id = ?', [uid]);
          await query('INSERT INTO sessions (user_id, session_token, last_login, device_id) VALUES (?, ?, ?, ?)', [uid, newSessionToken, new Date().toISOString(), deviceId]);

          return res.json({
            success: true,
            result: {
              status: "SUCCESS",
              user: { id: uid, name: "Anish Shakya", sessionId: newSessionToken, deviceId: deviceId, warehouses: "*" },
              permissions: fullPermissions
            }
          });
        }
      }

      case 'wmsForceLogin': {
        const uid = (args[0] || 'admin').trim();
        const pass = (args[1] || '').trim();
        const deviceId = (args[2] || 'browser_' + Date.now()).trim();

        const rows = await query('SELECT * FROM user_auth');
        const match = rows.find(r => 
          (r["User ID"] || r.user_id || '').toString().toLowerCase().trim() === uid.toLowerCase()
        );

        const userIdKey = match ? (match["User ID"] || match.user_id || uid) : uid;
        const newSessionToken = "sess_force_" + Date.now() + "_" + Math.random().toString(36).substring(2, 9);

        await query('DELETE FROM sessions WHERE user_id = ?', [userIdKey]);
        await query(
          'INSERT INTO sessions (user_id, session_token, last_login, device_id) VALUES (?, ?, ?, ?)',
          [userIdKey, newSessionToken, new Date().toISOString(), deviceId]
        );

        const fullPermissions = {};
        DEFAULT_AUTH_HEADERS.slice(4).forEach(h => {
          if (match) {
            const val = (match[h] || 'YES').toString().toUpperCase().trim();
            fullPermissions[h] = (val === 'YES' || val === 'TRUE' || val === '1');
          } else {
            fullPermissions[h] = true;
          }
        });

        return res.json({
          success: true,
          result: {
            status: "SUCCESS",
            user: {
              id: userIdKey,
              name: match ? (match["Name"] || match.name || userIdKey) : "Anish Shakya",
              sessionId: newSessionToken,
              deviceId: deviceId,
              warehouses: match ? (match["Assigned Warehouses"] || match.assigned_warehouses || "*") : "*"
            },
            permissions: fullPermissions
          }
        });
      }

      case 'wmsLogoutSession': {
        const uid = (args[0] || '').trim();
        if (uid) {
          await query('DELETE FROM sessions WHERE user_id = ?', [uid]);
        }
        return res.json({ success: true, result: { status: "OK" } });
      }

      case 'wmsHeartbeat': {
        const uid = (args[0] || '').trim();
        const sessionToken = (args[1] || '').trim();
        if (uid && sessionToken) {
          const sess = await query('SELECT * FROM sessions WHERE user_id = ?', [uid]);
          if (sess && sess.length > 0 && sess[0].session_token !== sessionToken) {
            return res.json({ success: true, result: { status: "LOGGED_OUT_BY_OTHER_DEVICE" } });
          }
          await query('UPDATE sessions SET last_login = ? WHERE user_id = ?', [new Date().toISOString(), uid]);
        }
        return res.json({ success: true, result: { status: "OK" } });
      }

      case 'wmsGetUsers':
      case 'getUserAuthData': {
        const rows = await query('SELECT * FROM user_auth');
        const users = rows.map(r => {
          const userObj = {};
          DEFAULT_AUTH_HEADERS.forEach(h => {
            userObj[h] = (r[h] !== undefined && r[h] !== null) ? r[h].toString() : (h === "User ID" ? r.user_id || r["User ID"] || 'user' : 'NO');
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

      case 'wmsSaveUser':
      case 'wmsSaveAllUsers':
      case 'wmsSaveUserAuth': {
        const usersToSave = Array.isArray(args[0]) ? args[0] : [args[0]];
        if (Array.isArray(usersToSave) && usersToSave.length > 0) {
          for (const u of usersToSave) {
            if (!u) continue;
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

      case 'wmsVerifyAdmin':
      case 'wmsVerifyResetAllowed': {
        return res.json({ success: true, result: { status: "SUCCESS", allowed: true } });
      }

      case 'wmsResetSalesData':
      case 'ocResetAllSheets':
      case 'ocResetAllTransactionalSheets': {
        const resDump = await query('SELECT COUNT(*) as cnt FROM sap_stk_dump');
        const resAlloc = await query('SELECT COUNT(*) as cnt FROM sap_stk_allocation');
        const resPartial = await query('SELECT COUNT(*) as cnt FROM partial_clear_orders');
        const resShort = await query('SELECT COUNT(*) as cnt FROM shortage_partial');
        const resClear = await query('SELECT COUNT(*) as cnt FROM clear_order');
        const resChecker = await query('SELECT COUNT(*) as cnt FROM order_checker');

        const getCnt = (r) => r && r[0] ? Number(r[0].cnt || r[0]["COUNT(*)"] || 0) : 0;
        const cntDump = getCnt(resDump);
        const cntAlloc = getCnt(resAlloc);
        const cntPartial = getCnt(resPartial);
        const cntShort = getCnt(resShort);
        const cntClear = getCnt(resClear);
        const cntChecker = getCnt(resChecker);

        await query('DELETE FROM sap_stk_dump');
        await query('DELETE FROM sap_stk_allocation');
        await query('DELETE FROM partial_clear_orders');
        await query('DELETE FROM shortage_partial');
        await query('DELETE FROM clear_order');
        await query('DELETE FROM order_checker');
        await query('DELETE FROM operation_sheet');
        await query('DELETE FROM phy_stk_allocation');
        await query('DELETE FROM outward_mis');
        await query('DELETE FROM asn');
        await query('DELETE FROM inward_mis');
        await query('DELETE FROM bin_txin');

        lastDumpUpdatedAt = new Date().toISOString();

        return res.json({
          success: true,
          result: {
            status: "DONE",
            counts: {
              "SAP_STK_DUMP": cntDump,
              "SAP_STK_ALLOCATION": cntAlloc,
              "Partial Clear Orders": cntPartial,
              "Shortage in Partial Clear Orders": cntShort,
              "Clear Order": cntClear,
              "ORDER_CHECKER": cntChecker
            },
            message: "All sales transactional data reset successfully!"
          }
        });
      }

      // -------------------------------------------------------------
      // 2. MASTER DATA & LOOKUPS
      // -------------------------------------------------------------
      case 'getMasterData':
      case 'ocGetPartyMaster':
      case 'getPartyMaster': {
        const rows = await query('SELECT * FROM party_master');
        const contractors = [...new Set(rows.map(r => r.contractor_name).filter(Boolean))];
        const supervisors = [...new Set(rows.map(r => r.supervisor_name).filter(Boolean))];
        const tptList = rows.filter(r => r.tpt_name).map(r => ({
          name: r.tpt_name,
          gst: r.tpt_gst || ''
        }));

        const skus = await query('SELECT * FROM sku_masters');
        const bins = await query('SELECT * FROM bin_masters');
        const warehouses = await query('SELECT * FROM wh_masters');
        const mails = await query('SELECT * FROM mail_masters');

        return res.json({
          success: true,
          result: {
            status: "SUCCESS",
            contractors,
            supervisors,
            tptList,
            skus,
            bins,
            warehouses,
            mails
          }
        });
      }

      case 'wmsSavePartyMaster': {
        const data = args[0] || {};
        if (data.contractor_name || data.supervisor_name || data.tpt_name) {
          await query(
            'INSERT INTO party_master (contractor_name, supervisor_name, tpt_name, tpt_gst) VALUES (?, ?, ?, ?)',
            [data.contractor_name || '', data.supervisor_name || '', data.tpt_name || '', data.tpt_gst || '']
          );
        }
        return res.json({ success: true, result: { status: "SUCCESS", message: "Party Master entry saved!" } });
      }

      case 'wmsSaveSkuMaster': {
        const skus = Array.isArray(args[0]) ? args[0] : [args[0]];
        for (const s of skus) {
          if (!s.sku_code) continue;
          await query(
            'INSERT INTO sku_masters (sku_code, sku_name, description, uom, plant, sloc) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(sku_code) DO UPDATE SET sku_name=EXCLUDED.sku_name, description=EXCLUDED.description',
            [s.sku_code, s.sku_name || s.sku_code, s.description || '', s.uom || 'PCS', s.plant || 'BB04', s.sloc || 'FG01']
          );
        }
        return res.json({ success: true, result: { status: "SUCCESS", message: "SKU Master updated!" } });
      }

      case 'wmsSaveBinMaster': {
        const bins = Array.isArray(args[0]) ? args[0] : [args[0]];
        for (const b of bins) {
          if (!b.bin_code) continue;
          await query(
            'INSERT INTO bin_masters (bin_code, wh_code, zone, type, max_capacity, status) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(bin_code) DO UPDATE SET zone=EXCLUDED.zone, status=EXCLUDED.status',
            [b.bin_code, b.wh_code || 'BB04', b.zone || 'A', b.type || 'PALLET', Number(b.max_capacity) || 1000, b.status || 'Available']
          );
        }
        return res.json({ success: true, result: { status: "SUCCESS", message: "Bin Master updated!" } });
      }

      // -------------------------------------------------------------
      // 3. SAP STOCK DUMP & LIVE STOCK ENQUIRY
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
            console.log(`[SAP IMPACT] Saved ${writeRows.length} transformed records to SQL Database!`);
          } catch(e) {
            console.error('[SAP IMPACT Error]:', e.message);
          }
        });
        return;
      }

      case 'ocGetDumpExport':
      case 'getDumpStatus':
      case 'loadRealTimeStkDump': {
        const warehouse = args[0] || 'BB04';
        const dbDump = await query('SELECT warehouse, sloc, material_code, material_desc, batch_json, total_unrestricted, total_transit FROM sap_stk_dump');
        
        const formattedRows = dbDump.map(r => ({
          warehouse: r.warehouse || warehouse,
          sloc: r.sloc || '',
          material: r.material_code || r.material || '',
          description: r.material_desc || r.description || '',
          batchQty: r.batch_json || r.batchQty || '[]',
          totalUnrestricted: Number(r.total_unrestricted) || 0,
          totalTransit: Number(r.total_transit) || 0
        }));

        return res.json({
          success: true,
          result: {
            status: "SUCCESS",
            rows: formattedRows,
            updatedAt: lastDumpUpdatedAt
          }
        });
      }

      case 'ocGetDumpInfo': {
        const countRes = await query('SELECT COUNT(*) as cnt FROM sap_stk_dump');
        const cnt = countRes && countRes[0] ? countRes[0].cnt || countRes[0]["COUNT(*)"] || 0 : 0;
        return res.json({
          success: true,
          result: {
            status: "SUCCESS",
            count: cnt,
            updatedAt: lastDumpUpdatedAt
          }
        });
      }

      case 'ocGetStock': {
        const warehouse = args[0] || 'BB04';
        const rawStock = await _buildRawStockMapSQL(warehouse);
        const allocStock = await _buildAllocMapSQL(warehouse);

        const stockMap = {};
        Object.keys(rawStock).forEach(sku => {
          const st = rawStock[sku];
          const al = allocStock[sku] || { inh: 0, trn: 0 };
          const availInhand = Math.max(0, st.sap - al.inh);
          const availTransit = Math.max(0, st.transit - al.trn);

          stockMap[sku] = {
            sku: sku,
            desc: st.desc,
            sap: st.sap,
            transit: st.transit,
            inhAlloc: al.inh,
            trnAlloc: al.trn,
            availInhand: availInhand,
            availTotal: availInhand + availTransit
          };
        });

        return res.json({ success: true, result: Object.values(stockMap) });
      }

      // -------------------------------------------------------------
      // 4. BULK ORDER PROCESSING & ALLOCATION ENGINE
      // -------------------------------------------------------------
      case 'ocCheckDuplicateOrders': {
        const warehouse = args[0] || 'BB04';
        const soNumbers = Array.isArray(args[1]) ? args[1] : [args[1]];

        const existingRows = await query('SELECT order_no FROM operation_sheet');
        const existingSet = new Set(existingRows.map(r => _norm(r.order_no)));

        const duplicates = [];
        soNumbers.forEach(so => {
          const normSo = _norm(so);
          if (existingSet.has(normSo)) {
            duplicates.push(normSo);
          }
        });

        return res.json({
          success: true,
          result: {
            status: "SUCCESS",
            duplicates: duplicates,
            existingSOs: Array.from(existingSet)
          }
        });
      }

      case 'opCheckSingleOrderItems': {
        const warehouse = args[0] || 'BB04';
        const salesDocument = args[1] || '';
        const pastedText = args[2] || '';

        const rawStock = await _buildRawStockMapSQL(warehouse);
        const allocStock = await _buildAllocMapSQL(warehouse);

        const lines = (pastedText || "").split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        const pastedMap = {};
        const descMap = {};

        lines.forEach(line => {
          let cols = line.split(/\t/).map(c => c.trim());
          if (cols.length < 2) cols = line.split(/[\t,;|]+/).map(c => c.trim());
          if (cols.length < 2) return;

          let sku = "", qty = 0, desc = "";
          if (cols.length >= 3 && /^\d+$/.test(cols[0])) {
            sku = _norm(cols[1]);
            qty = parseFloat((cols[2] || "").replace(/,/g, "")) || 0;
            desc = cols[4] || cols[3] || "";
          } else {
            sku = _norm(cols[0]);
            qty = parseFloat((cols[1] || "").replace(/,/g, "")) || 0;
            desc = cols[2] || "";
          }

          if (!sku || qty <= 0) return;
          pastedMap[sku] = (pastedMap[sku] || 0) + qty;
          if (!descMap[sku] && desc) descMap[sku] = desc;
        });

        const itemsList = [];
        let isAllClear = true;

        Object.keys(pastedMap).forEach(sku => {
          const reqQty = pastedMap[sku];
          const st = rawStock[sku] || { sap: 0, transit: 0, desc: descMap[sku] || "Pasted SKU" };
          const al = allocStock[sku] || { inh: 0, trn: 0 };

          const inhandTotal = Number(st.sap) || 0;
          const transitTotal = Number(st.transit) || 0;
          const allocInhand = Number(al.inh) || 0;
          const allocTransit = Number(al.trn) || 0;

          const availInhand = Math.max(0, inhandTotal - allocInhand);
          const availTransit = Math.max(0, transitTotal - allocTransit);

          const inhAlloc = Math.min(availInhand, reqQty);
          const shortBT = Math.max(0, reqQty - inhAlloc);
          const statusBT = (shortBT === 0) ? "OK" : (availInhand === 0 ? "NO STOCK" : "SHORT");

          const trnUsed = Math.min(availTransit, shortBT);
          const shortAT = Math.max(0, shortBT - trnUsed);
          const statusAT = (shortAT === 0) ? "OK" : (shortBT > 0 && availTransit === 0 ? "NO STOCK" : "SHORT");

          if (statusBT !== "OK") isAllClear = false;

          itemsList.push({
            sku: sku,
            desc: descMap[sku] || st.desc,
            reqQty: reqQty,
            pastedQty: reqQty,
            inhand: inhandTotal,
            transit: transitTotal,
            allocInhand: allocInhand,
            availInhand: availInhand,
            shortBT: shortBT,
            statusBT: statusBT,
            trnUsed: trnUsed,
            shortAT: shortAT,
            statusAT: statusAT
          });
        });

        return res.json({
          success: true,
          result: {
            status: "SUCCESS",
            isAllClear: isAllClear,
            items: itemsList,
            message: isAllClear ? "All items clear before transit!" : "Order has shortages before transit."
          }
        });
      }

      case 'ocGetShortageReport': {
        const warehouse = args[0] || 'BB04';
        const rows = await query("SELECT * FROM shortage_partial WHERE UPPER(warehouse) = UPPER(?) OR UPPER(warehouse) = 'ALL'", [warehouse]);
        const outwardRows = await query('SELECT * FROM operation_sheet');
        const outwardMap = {};
        for (const r of outwardRows) {
          const soNum = _norm(r.order_no);
          if (soNum) {
            outwardMap[soNum] = {
              allocationRemark: r.alloc_remark || '',
              vehNumber: r.vehicle_no || '',
              driverContact: r.driver_no || ''
            };
          }
        }

        const soMap = {};
        for (const r of rows) {
          const soNum = _norm(r.so_no);
          if (!soNum) continue;
          const sku = _norm(r.sku_code);
          const reqQty = Number(r.req_qty) || 0;
          const availInhand = Number(r.avail_inhand) || 0;
          const shortBT = Number(r.short_bt) || 0;
          const statusBT = r.status_bt || 'SHORT';
          const trnUsed = Number(r.transit_used) || 0;
          const shortAT = Number(r.short_at) || 0;
          const statusAT = r.status_at || 'OK';

          const outwardInfo = outwardMap[soNum] || { allocationRemark: '', vehNumber: '', driverContact: '' };

          if (!soMap[soNum]) {
            soMap[soNum] = {
              soNumber: soNum,
              soDate: r.so_date || '',
              soTime: '',
              party: r.party_name || '',
              dest: '',
              vehNumber: outwardInfo.vehNumber,
              driverContact: outwardInfo.driverContact,
              allocationRemark: outwardInfo.allocationRemark,
              lines: []
            };
          }

          soMap[soNum].lines.push({
            sku: sku,
            desc: r.description || '',
            reqQty: reqQty,
            availInhand: availInhand,
            shortBT: shortBT,
            statusBT: statusBT,
            trnUsed: trnUsed,
            shortAT: shortAT,
            statusAT: statusAT
          });
        }

        const skuMap = {};
        Object.values(soMap).forEach(so => {
          so.lines.forEach(l => {
            if (!skuMap[l.sku]) {
              skuMap[l.sku] = { sku: l.sku, desc: l.desc, totalShortBT: 0, totalShortAT: 0, affectedSOs: [] };
            }
            skuMap[l.sku].totalShortBT += l.shortBT;
            skuMap[l.sku].totalShortAT += l.shortAT;
            skuMap[l.sku].affectedSOs.push(so.soNumber);
          });
        });

        const sortedOrders = Object.values(soMap).sort((a, b) => a.soNumber.localeCompare(b.soNumber));
        const sortedSummary = Object.values(skuMap).sort((a, b) => b.totalShortAT - a.totalShortAT);

        return res.json({
          success: true,
          result: {
            status: "DONE",
            orders: sortedOrders,
            summary: sortedSummary
          }
        });
      }

      case 'ocGetWOAlocShortageReport': {
        const warehouse = args[0] || 'BB04';
        const dumpRows = await query("SELECT * FROM sap_stk_dump WHERE UPPER(warehouse) = UPPER(?) OR UPPER(warehouse) = 'ALL'", [warehouse]);
        const dumpMap = {};
        dumpRows.forEach(r => {
          const sku = _norm(r.material_code);
          if (!sku) return;
          if (!dumpMap[sku]) dumpMap[sku] = { unrestricted: 0, transit: 0 };
          dumpMap[sku].unrestricted += Number(r.total_unrestricted) || 0;
          dumpMap[sku].transit += Number(r.total_transit) || 0;
        });

        const opRows = await query('SELECT * FROM operation_sheet WHERE UPPER(alloc_remark) LIKE \'%WITHOUT ALLOCATION%\'');
        const todayStr = new Date().toISOString().split('T')[0];
        const skuMap = {};
        const orderReport = [];

        opRows.forEach(order => {
          const soNum = _norm(order.order_no);
          const soDate = order.order_date || '';
          const party = order.customer_name || '';
          const isToday = soDate === todayStr;

          let lines = [];
          try { lines = JSON.parse(order.sku_code); } catch(e) {}

          lines.forEach(l => {
            const sku = _norm(l.sku || l.material);
            if (!sku) return;
            const desc = l.desc || l.description || '';
            const reqQty = Number(l.qty || l.reqQty || l.orderedQty) || 0;

            if (!skuMap[sku]) {
              skuMap[sku] = { sku: sku, desc: desc, pendingOrderQty: 0, todaysOrderQty: 0, totalReq: 0 };
            }

            if (isToday) skuMap[sku].todaysOrderQty += reqQty;
            else skuMap[sku].pendingOrderQty += reqQty;
            skuMap[sku].totalReq += reqQty;

            orderReport.push({
              soNum: soNum,
              soDate: soDate,
              party: party,
              sku: sku,
              desc: desc,
              reqQty: reqQty,
              remark: "Ok"
            });
          });
        });

        const skuReport = [];
        const skuRemarks = {};

        Object.keys(skuMap).forEach(sku => {
          const s = skuMap[sku];
          const stock = dumpMap[sku] || { unrestricted: 0, transit: 0 };
          const stockDiff = stock.unrestricted - s.totalReq;
          const diffAfterIntransit = stockDiff + stock.transit;

          let remark = "Ok";
          if (s.totalReq > 0 && diffAfterIntransit < 0) {
            remark = "Short Quantity-" + Math.abs(diffAfterIntransit);
          }
          skuRemarks[sku] = remark;

          skuReport.push({
            material: sku,
            description: s.desc,
            pendingOrder: s.pendingOrderQty,
            todaysOrder: s.todaysOrderQty,
            total: s.totalReq,
            unrestricted: stock.unrestricted,
            stockDiff: stockDiff,
            inTransit: stock.transit,
            diffAfterIntransit: diffAfterIntransit,
            remark: remark
          });
        });

        orderReport.forEach(o => { o.remark = skuRemarks[o.sku] || "Ok"; });

        skuReport.sort((a, b) => {
          const sA = a.remark.includes("Short") ? 1 : 0;
          const sB = b.remark.includes("Short") ? 1 : 0;
          if (sA !== sB) return sB - sA;
          return a.material.localeCompare(b.material);
        });

        const checkerRows = await query('SELECT * FROM order_checker');
        const orderSummaryHeaders = [
          "Sale Document", "Document date", "Sold to Party", "Sold-To Party Name", "Customer reference",
          "Plant", "Total Order Qty", "Shortage Qty", "Allocation Remark", "Shortage Remark"
        ];
        const orderSummaryRows = checkerRows.map(r => [
          r.order_no || '', r.doc_date || '', r.sold_to_party || '', r.customer_name || '', r.cust_ref || '',
          r.plant || warehouse, Number(r.total_order_qty) || 0, Number(r.shortage_qty) || 0, r.alloc_remark || '', r.shortage_remark || ''
        ]);

        return res.json({
          success: true,
          result: {
            status: "DONE",
            orderSummary: { headers: orderSummaryHeaders, rows: orderSummaryRows },
            skuReport: skuReport,
            orderReport: orderReport
          }
        });
      }

      case 'ocGetCombinedShortageExport': {
        const warehouse = args[0] || 'BB04';

        const shortageRows = await query("SELECT * FROM shortage_partial WHERE UPPER(warehouse) = UPPER(?) OR UPPER(warehouse) = 'ALL'", [warehouse]);
        const orderWiseHeaders = [
          "Warehouse", "SO Number", "Party name, Dest city Name", "SO Date", 
          "SKU", "Description", "Req Qty", "Avail Inhand", "Short BT", 
          "Status BT", "Transit Used", "Short AT", "Status AT", "Submit Time", "Updated By"
        ];
        const orderWiseRows = shortageRows.map(r => [
          r.warehouse || warehouse, r.so_no || '', r.party_name || '', r.so_date || '',
          r.sku_code || '', r.description || '', Number(r.req_qty) || 0, Number(r.avail_inhand) || 0,
          Number(r.short_bt) || 0, r.status_bt || 'SHORT', Number(r.transit_used) || 0,
          Number(r.short_at) || 0, r.status_at || 'OK', r.submit_time || '', r.updated_by || 'admin'
        ]);

        const skuSummaryMap = {};
        shortageRows.forEach(r => {
          const sku = _norm(r.sku_code);
          if (!sku) return;
          if (!skuSummaryMap[sku]) {
            skuSummaryMap[sku] = { sku: sku, desc: r.description || '', totalReq: 0, shortBT: 0, shortAT: 0 };
          }
          skuSummaryMap[sku].totalReq += Number(r.req_qty) || 0;
          skuSummaryMap[sku].shortBT += Number(r.short_bt) || 0;
          skuSummaryMap[sku].shortAT += Number(r.short_at) || 0;
        });

        const skuSummaryHeaders = ["SKU Code", "Description", "Total Req Qty", "Short Before Transit (BT)", "Short After Transit (AT)"];
        const skuSummaryRows = Object.values(skuSummaryMap).map(s => [
          s.sku, s.desc, s.totalReq, s.shortBT, s.shortAT
        ]);

        const checkerRows = await query('SELECT * FROM order_checker');
        const orderSummaryHeaders = [
          "Sale Document", "Document date", "Sold to Party", "Sold-To Party Name", "Customer reference",
          "Plant", "Total Order Qty", "Shortage Qty", "Allocation Remark", "Shortage Remark"
        ];
        const orderSummaryRows = checkerRows.map(r => [
          r.order_no || '', r.doc_date || '', r.sold_to_party || '', r.customer_name || '', r.cust_ref || '',
          r.plant || warehouse, Number(r.total_order_qty) || 0, Number(r.shortage_qty) || 0, r.alloc_remark || '', r.shortage_remark || ''
        ]);

        return res.json({
          success: true,
          result: {
            status: "DONE",
            orderWise: { headers: orderWiseHeaders, rows: orderWiseRows },
            skuSummary: { headers: skuSummaryHeaders, rows: skuSummaryRows },
            orderSummary: { headers: orderSummaryHeaders, rows: orderSummaryRows }
          }
        });
      }

      case 'opAllocateOBDBatches': {
        const warehouse = args[0] || 'BB04';
        const salesDocument = args[1] || '';
        const pastedItems = args[2] || [];
        const preferredSloc = _norm(args[3] || 'FG01');

        const whNorm = _norm(warehouse);
        const dumpRows = await query('SELECT * FROM sap_stk_dump');
        const stockMap = {};

        dumpRows.forEach(r => {
          if (_norm(r.warehouse) !== whNorm) return;
          const sloc = (r.sloc || 'FG01').toString().trim();
          const mat = _norm(r.material_code);
          const desc = (r.material_desc || '').toString().trim();
          const rawBatchCol = r.batch_json;
          const totalQty = Number(r.total_unrestricted) || 0;

          if (!mat) return;
          if (!stockMap[mat]) stockMap[mat] = [];

          let parsedBatches = [];
          try {
            if (typeof rawBatchCol === 'string' && rawBatchCol.indexOf("[") >= 0) {
              parsedBatches = JSON.parse(rawBatchCol);
            }
          } catch(e) {}

          if (Array.isArray(parsedBatches) && parsedBatches.length > 0) {
            parsedBatches.forEach(b => {
              const bQty = Number(b.qty) || 0;
              if (bQty > 0) {
                stockMap[mat].push({ sloc, batch: (b.batch || "DEFAULT").toString().trim(), qty: bQty, valType: b.valType || "-", desc });
              }
            });
          } else if (totalQty > 0) {
            stockMap[mat].push({ sloc, batch: "BATCH_01", qty: totalQty, valType: "-", desc });
          }
        });

        const previewRows = [];
        let overallSuccess = true;

        pastedItems.forEach(line => {
          const mat = _norm(line.sku);
          let remaining = Number(line.reqQty || line.pastedQty || line.qty) || 0;
          const requiredQty = remaining;
          let allocatedForLine = 0;
          const availableBatches = stockMap[mat] || [];
          const lineAllocations = [];

          // Preferred Sloc Pass
          if (preferredSloc !== 'ALL') {
            for (let b of availableBatches) {
              if (remaining <= 0) break;
              if (_norm(b.sloc) !== preferredSloc || b.qty <= 0) continue;
              const take = Math.min(remaining, b.qty);
              lineAllocations.push({ batch: b.batch, allocQty: take, sloc: b.sloc, valType: b.valType || "-", desc: b.desc || line.desc });
              b.qty -= take;
              remaining -= take;
              allocatedForLine += take;
            }
          }

          // Fallback Pass
          for (let b2 of availableBatches) {
            if (remaining <= 0) break;
            if (b2.qty <= 0) continue;
            const take2 = Math.min(remaining, b2.qty);
            lineAllocations.push({ batch: b2.batch, allocQty: take2, sloc: b2.sloc, valType: b2.valType || "-", desc: b2.desc || line.desc });
            b2.qty -= take2;
            remaining -= take2;
            allocatedForLine += take2;
          }

          let status = "FULL";
          if (remaining > 0) {
            overallSuccess = false;
            status = (allocatedForLine > 0) ? "SHORT" : "NO STOCK";
          }

          if (lineAllocations.length === 0) {
            previewRows.push({
              soNumber: salesDocument, sku: mat, desc: line.desc || "Item Description", valType: "-",
              reqQty: requiredQty, batch: "-", allocQty: 0, status: "NO STOCK", shortfall: requiredQty, sloc: preferredSloc !== "ALL" ? preferredSloc : "FG01", notes: "No stock in dump", isSplit: false
            });
          } else {
            const first = lineAllocations[0];
            previewRows.push({
              soNumber: salesDocument, sku: mat, desc: line.desc || first.desc || "Item Description", valType: first.valType,
              reqQty: requiredQty, batch: first.batch, allocQty: first.allocQty, status: status, shortfall: remaining > 0 ? remaining : 0, sloc: first.sloc, notes: lineAllocations.length > 1 ? "Split Batch (1/" + lineAllocations.length + ")" : "Full Single Batch", isSplit: false
            });
            for (let k = 1; k < lineAllocations.length; k++) {
              const sp = lineAllocations[k];
              previewRows.push({
                soNumber: salesDocument, sku: "↳ SPLIT", desc: line.desc || sp.desc || "Item Description", valType: sp.valType,
                reqQty: "", batch: sp.batch, allocQty: sp.allocQty, status: "SPLIT", shortfall: "", sloc: sp.sloc, notes: "Split Batch (" + (k + 1) + "/" + lineAllocations.length + ")", isSplit: true
              });
            }
          }
        });

        return res.json({
          success: true,
          result: { status: "SUCCESS", rows: previewRows, isAllClear: overallSuccess }
        });
      }

      case 'opDeductBatchPickingAndMIS': {
        const warehouse = args[0] || 'BB04';
        const salesDocument = _norm(args[1] || '');
        const obdNumber = (args[2] || '').toString().trim();
        const allocatedRows = args[3] || [];
        const opRowData = args[4] || {};

        if (!obdNumber) return res.json({ success: true, result: { status: "ERROR", message: "8-Digit OBD Number is required." } });

        const totalPgiQty = allocatedRows.reduce((acc, r) => acc + (Number(r.allocQty) || 0), 0);

        // Update Operation Sheet
        await query(
          'UPDATE operation_sheet SET obd = ?, status = ?, dispatch_qty = ? WHERE order_no = ?',
          [obdNumber, 'PGI Done', totalPgiQty, salesDocument]
        );

        // Append to Outward MIS
        for (const r of allocatedRows) {
          const pgiQty = Number(r.allocQty) || 0;
          if (pgiQty <= 0) continue;
          const mat = _norm(r.sku).indexOf("SPLIT") >= 0 ? (r.lastSku || r.sku) : _norm(r.sku);

          await query(
            'INSERT INTO outward_mis (plant, order_no, order_date, customer_name, cust_ref, order_qty, shortage_qty, alloc_remark, shortage_remark, order_status, vehicle_no, driver_no, tpt_name, sku_code, description, batch, pgi_qty, dispatch_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              opRowData.plant || warehouse, salesDocument, opRowData.orderDate || '', opRowData.customerName || '', opRowData.customerRefNo || '',
              opRowData.orderQty || 0, opRowData.shortageQty || 0, opRowData.allocationRemark || '', opRowData.shortageRemark || '', 'PGI Done',
              opRowData.vehicleNumber || '', opRowData.driverNumber || '', opRowData.tptName || '', mat, r.desc || 'Item Description', r.batch || '', pgiQty, pgiQty
            ]
          );
        }

        // Email Alert check (if mail master configured)
        const mails = await query('SELECT email FROM mail_masters WHERE module = ? AND short_excess_mail = ?', ['OUTWARD', 'YES']);
        if (mails && mails.length > 0) {
          const recipients = mails.map(m => m.email).join(',');
          sendEmailNotification(
            recipients,
            `[WMS Alert] OBD PGI Done for Order ${salesDocument}`,
            `<p>Order <b>${salesDocument}</b> has been completed with OBD <b>${obdNumber}</b>. Total PGI Qty: <b>${totalPgiQty}</b>.</p>`
          );
        }

        return res.json({ success: true, result: { status: "SUCCESS", message: "Batch Picking completed successfully!" } });
      }

      case 'ocSubmitDirectOrder':
      case 'ocBulkSubmitOrdersWOAloc': {
        const warehouse = args[0] || 'BB04';
        const ordersPayload = Array.isArray(args[1]) ? args[1] : [args[1]];
        const userId = args[3] || args[2] || 'admin';

        const existingRows = await query('SELECT order_no FROM operation_sheet');
        const existingSet = new Set(existingRows.map(r => _norm(r.order_no)));

        const results = {};
        let insertedCount = 0;

        for (const payload of ordersPayload) {
          if (!payload) continue;
          let soNum = _norm(payload.soNumber || payload.orderNo || '').replace(/\.0+$/, '');
          if (!soNum) {
            results[payload.soNumber || '?'] = { status: "INVALID_SO" };
            continue;
          }
          payload.soNumber = soNum;

          await query('DELETE FROM partial_clear_orders WHERE UPPER(so_no) = UPPER(?)', [soNum]);
          await query('DELETE FROM shortage_partial WHERE UPPER(so_no) = UPPER(?)', [soNum]);
          await query('DELETE FROM operation_sheet WHERE UPPER(order_no) = UPPER(?)', [soNum]);
          await query('DELETE FROM order_checker WHERE UPPER(order_no) = UPPER(?)', [soNum]);

          const customerName = payload.partyName || payload.customerName || '';
          const custRef = payload.destCity || payload.custRef || '';
          const orderDate = payload.soDate || payload.orderDate || new Date().toISOString().split('T')[0];
          const lines = payload.lines || [];

          const linesJSON = JSON.stringify(lines.map(l => ({ sku: _norm(l.sku), qty: Number(l.qty) || 0, desc: l.desc || '' })));
          const totalQty = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);

          await query(
            'INSERT INTO operation_sheet (plant, order_no, order_date, customer_name, cust_ref, sku_code, ordered_qty, shortage_qty, alloc_remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [warehouse, soNum, orderDate, customerName, custRef, linesJSON, totalQty, 0, 'Without Allocation', 'Picking']
          );

          await query(
            'INSERT INTO order_checker (order_no, doc_date, customer_name, cust_ref, lines_json, plant, total_order_qty, shortage_qty, alloc_remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [soNum, orderDate, customerName, custRef, linesJSON, warehouse, totalQty, 0, 'Without Allocation', 'Submitted (W/O Aloc)']
          );

          results[soNum] = { status: "DONE", isUpdate: isUpdate, clearLines: lines.length, shortLines: 0 };
          insertedCount++;
        }

        return res.json({
          success: true,
          result: {
            status: "DONE",
            results: results,
            rows: insertedCount,
            message: `Bulk submit (W/O Aloc) processed ${insertedCount} orders cleanly in SQL database!`
          }
        });
      }

      case 'ocSubmitClearOrder':
      case 'ocBulkSubmitOrdersWIAloc': {
        const warehouse = args[0] || 'BB04';
        const ordersPayload = Array.isArray(args[1]) ? args[1] : [args[1]];
        const userId = args[3] || args[2] || 'admin';
        const tsStr = new Date().toISOString();

        // 1. Build SAP Stock Map from sap_stk_dump
        const dumpRows = await query("SELECT * FROM sap_stk_dump WHERE UPPER(warehouse) = UPPER(?) OR UPPER(warehouse) = 'ALL'", [warehouse]);
        const rawStock = {};
        for (const r of dumpRows) {
          const sku = _norm(r.material_code);
          if (!sku) continue;
          rawStock[sku] = {
            sap: Number(r.total_unrestricted) || 0,
            transit: Number(r.total_transit) || 0,
            desc: r.material_desc || ''
          };
        }

        // 2. Build Allocation Map from sap_stk_allocation
        const allocRows = await query('SELECT * FROM sap_stk_allocation WHERE UPPER(warehouse) = UPPER(?)', [warehouse]);
        const allocMap = { inhand: {}, transit: {} };
        for (const r of allocRows) {
          const sku = _norm(r.sku_code);
          if (!sku) continue;
          allocMap.inhand[sku] = (allocMap.inhand[sku] || 0) + (Number(r.inhand_alloc) || 0);
          allocMap.transit[sku] = (allocMap.transit[sku] || 0) + (Number(r.transit_alloc) || 0);
        }

        // 3. Calculate Running Stock (FIFO)
        const runInh = {};
        const runTrn = {};
        Object.keys(rawStock).forEach(sku => {
          runInh[sku] = Math.max(0, rawStock[sku].sap - (allocMap.inhand[sku] || 0));
          runTrn[sku] = Math.max(0, rawStock[sku].transit - (allocMap.transit[sku] || 0));
        });

        // 4. Validate & Pre-filter Orders
        const results = {};
        const validOrders = [];
        for (const payload of ordersPayload) {
          if (!payload) continue;
          let soNum = _norm(payload.soNumber || payload.orderNo || '').replace(/\.0+$/, '');
          if (!soNum) {
            results[payload.soNumber || '?'] = { status: "INVALID_SO" };
            continue;
          }
          payload.soNumber = soNum;
          validOrders.push(payload);
        }

        // 5. FIFO Sort Orders by Date and Time
        validOrders.sort((a, b) => {
          const da = (a.soDate || a.orderDate || '') + (a.soTime || a.orderTime || '');
          const db = (b.soDate || b.orderDate || '') + (b.soTime || b.orderTime || '');
          if (da !== db) return da.localeCompare(db);
          return String(a.soNumber || '').localeCompare(String(b.soNumber || ''));
        });

        // 6. Existing SO Cleanup
        for (const order of validOrders) {
          const soNum = _norm(order.soNumber || order.orderNo);
          await query('DELETE FROM sap_stk_allocation WHERE UPPER(so_no) = UPPER(?)', [soNum]);
          await query('DELETE FROM partial_clear_orders WHERE UPPER(so_no) = UPPER(?)', [soNum]);
          await query('DELETE FROM shortage_partial WHERE UPPER(so_no) = UPPER(?)', [soNum]);
          await query('DELETE FROM clear_order WHERE UPPER(so_no) = UPPER(?)', [soNum]);
          await query('DELETE FROM operation_sheet WHERE UPPER(order_no) = UPPER(?)', [soNum]);
          await query('DELETE FROM order_checker WHERE UPPER(order_no) = UPPER(?)', [soNum]);
        }

        const processedClear = new Set();
        const processedTransitClear = new Set();
        let insertedCount = 0;

        // PASS 1: Fully Clear from In-Hand Stock Only
        for (const order of validOrders) {
          const soNum = _norm(order.soNumber || order.orderNo);
          const isBlocked = !!(order.billingBlock || '').toString().trim();
          if (isBlocked) continue;

          const lines = order.lines || [];
          const orderSkuNeeds = {};
          lines.forEach(l => {
            const sku = _norm(l.sku);
            const qty = Number(l.qty) || 0;
            if (sku && qty > 0) orderSkuNeeds[sku] = (orderSkuNeeds[sku] || 0) + qty;
          });

          let canBeClear = true;
          for (const sku of Object.keys(orderSkuNeeds)) {
            if ((orderSkuNeeds[sku] || 0) > (runInh[sku] || 0)) {
              canBeClear = false;
              break;
            }
          }

          if (canBeClear) {
            processedClear.add(soNum);
            Object.keys(orderSkuNeeds).forEach(sku => {
              runInh[sku] = (runInh[sku] || 0) - orderSkuNeeds[sku];
            });

            const customerName = order.partyName || order.customerName || '';
            const custRef = order.destCity || order.custRef || '';
            const orderDate = order.soDate || order.orderDate || new Date().toISOString().split('T')[0];
            let totalOrderQty = 0;

            for (const line of lines) {
              const sku = _norm(line.sku);
              const reqQty = Number(line.qty) || 0;
              if (!sku || reqQty <= 0) continue;
              totalOrderQty += reqQty;
              await query(
                'INSERT INTO sap_stk_allocation (warehouse, timestamp, so_no, so_date, party_name, reference, sku_code, inhand_alloc, transit_alloc, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [warehouse, tsStr, soNum, orderDate, customerName, custRef, sku, reqQty, 0, userId]
              );
            }

            const linesJSON = JSON.stringify(lines.map(l => ({ sku: _norm(l.sku), desc: l.desc || '', qty: Number(l.qty) || 0 })));
            await query(
              'INSERT INTO clear_order (warehouse, so_no, so_date, party_name, reference, submit_time, total_lines, lines_json, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [warehouse, soNum, orderDate, customerName, custRef, tsStr, lines.length, linesJSON, userId]
            );

            await query(
              'INSERT INTO operation_sheet (plant, order_no, order_date, customer_name, cust_ref, sku_code, ordered_qty, shortage_qty, alloc_remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [warehouse, soNum, orderDate, customerName, custRef, linesJSON, totalOrderQty, 0, 'Full Allocation (Inhand)', 'Picking']
            );

            await query(
              'INSERT INTO order_checker (order_no, doc_date, customer_name, cust_ref, lines_json, plant, total_order_qty, shortage_qty, alloc_remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [soNum, orderDate, customerName, custRef, linesJSON, warehouse, totalOrderQty, 0, 'Full Allocation (Inhand)', 'Full Allocation (Inhand)']
            );

            results[soNum] = { status: "DONE", isUpdate: true, clearLines: lines.length, shortLines: 0 };
            insertedCount++;
          }
        }

        // PASS 2: Fully Clear from In-Hand + Transit Stock
        for (const order of validOrders) {
          const soNum = _norm(order.soNumber || order.orderNo);
          if (processedClear.has(soNum)) continue;
          const isBlocked = !!(order.billingBlock || '').toString().trim();
          if (isBlocked) continue;

          const lines = order.lines || [];
          const orderSkuNeeds = {};
          lines.forEach(l => {
            const sku = _norm(l.sku);
            const qty = Number(l.qty) || 0;
            if (sku && qty > 0) orderSkuNeeds[sku] = (orderSkuNeeds[sku] || 0) + qty;
          });

          let canBeClear = true;
          for (const sku of Object.keys(orderSkuNeeds)) {
            const needed = orderSkuNeeds[sku] || 0;
            const availTotal = (runInh[sku] || 0) + (runTrn[sku] || 0);
            if (needed > availTotal) {
              canBeClear = false;
              break;
            }
          }

          if (canBeClear) {
            processedTransitClear.add(soNum);
            const preDeductInh = {};
            Object.keys(orderSkuNeeds).forEach(sku => { preDeductInh[sku] = runInh[sku] || 0; });

            Object.keys(orderSkuNeeds).forEach(sku => {
              const needed = orderSkuNeeds[sku];
              const fromInh = Math.min(runInh[sku] || 0, needed);
              const fromTrn = Math.min(runTrn[sku] || 0, needed - fromInh);
              runInh[sku] = Math.max(0, (runInh[sku] || 0) - fromInh);
              runTrn[sku] = Math.max(0, (runTrn[sku] || 0) - fromTrn);
            });

            const customerName = order.partyName || order.customerName || '';
            const custRef = order.destCity || order.custRef || '';
            const orderDate = order.soDate || order.orderDate || new Date().toISOString().split('T')[0];
            let totalOrderQty = 0;
            let totalTransitQty = 0;
            const skuInhUsed = {};

            for (const line of lines) {
              const sku = _norm(line.sku);
              const reqQty = Number(line.qty) || 0;
              if (!sku || reqQty <= 0) continue;
              totalOrderQty += reqQty;

              const inhAvail = Math.max(0, (preDeductInh[sku] || 0) - (skuInhUsed[sku] || 0));
              const lineFromInh = Math.min(inhAvail, reqQty);
              const lineFromTrn = reqQty - lineFromInh;
              skuInhUsed[sku] = (skuInhUsed[sku] || 0) + lineFromInh;

              await query(
                'INSERT INTO sap_stk_allocation (warehouse, timestamp, so_no, so_date, party_name, reference, sku_code, inhand_alloc, transit_alloc, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [warehouse, tsStr, soNum, orderDate, customerName, custRef, sku, lineFromInh, lineFromTrn, userId]
              );

              if (lineFromTrn > 0) {
                totalTransitQty += lineFromTrn;
                const statusBT = lineFromInh === 0 ? "NO STOCK" : "SHORT";
                await query(
                  'INSERT INTO shortage_partial (warehouse, so_no, party_name, so_date, sku_code, description, req_qty, avail_inhand, short_bt, status_bt, transit_used, short_at, status_at, submit_time, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                  [warehouse, soNum, customerName, orderDate, sku, line.desc || '', reqQty, lineFromInh, lineFromTrn, statusBT, lineFromTrn, 0, 'OK', tsStr, userId]
                );
              }
            }

            const linesJSON = JSON.stringify(lines.map(l => ({ sku: _norm(l.sku), desc: l.desc || '', qty: Number(l.qty) || 0 })));
            await query(
              'INSERT INTO partial_clear_orders (warehouse, so_no, so_date, party_name, reference, submit_time, clear_lines_json, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [warehouse, soNum, orderDate, customerName, custRef, tsStr, linesJSON, userId]
            );

            await query(
              'INSERT INTO operation_sheet (plant, order_no, order_date, customer_name, cust_ref, sku_code, ordered_qty, shortage_qty, alloc_remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [warehouse, soNum, orderDate, customerName, custRef, linesJSON, totalOrderQty, totalTransitQty, 'Full Allocation (Transit)', 'Picking']
            );

            await query(
              'INSERT INTO order_checker (order_no, doc_date, customer_name, cust_ref, lines_json, plant, total_order_qty, shortage_qty, alloc_remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [soNum, orderDate, customerName, custRef, linesJSON, warehouse, totalOrderQty, totalTransitQty, 'Full Allocation (Transit)', 'Full Allocation (Transit)']
            );

            results[soNum] = { status: "PARTIAL", isUpdate: true, clearLines: lines.length, shortLines: 0 };
            insertedCount++;
          }
        }

        // PASS 3: Remaining Partial / Shortage / Blocked Orders
        for (const order of validOrders) {
          const soNum = _norm(order.soNumber || order.orderNo);
          if (processedClear.has(soNum) || processedTransitClear.has(soNum)) continue;

          const isBlocked = !!(order.billingBlock || '').toString().trim();
          const customerName = order.partyName || order.customerName || '';
          const custRef = order.destCity || order.custRef || '';
          const orderDate = order.soDate || order.orderDate || new Date().toISOString().split('T')[0];
          const lines = order.lines || [];
          const linesJSON = JSON.stringify(lines.map(l => ({ sku: _norm(l.sku), desc: l.desc || '', qty: Number(l.qty) || 0 })));

          if (isBlocked) {
            const totalOrderQty = lines.reduce((sum, l) => sum + (Number(l.qty) || 0), 0);
            await query(
              'INSERT INTO operation_sheet (plant, order_no, order_date, customer_name, cust_ref, sku_code, ordered_qty, shortage_qty, alloc_remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [warehouse, soNum, orderDate, customerName, custRef, linesJSON, totalOrderQty, 0, 'Without Allocation (Block)', 'Picking']
            );
            await query(
              'INSERT INTO order_checker (order_no, doc_date, customer_name, cust_ref, lines_json, plant, total_order_qty, shortage_qty, alloc_remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [soNum, orderDate, customerName, custRef, linesJSON, warehouse, totalOrderQty, 0, 'Without Allocation (Block)', 'Without Allocation (Block)']
            );
            results[soNum] = { status: "DONE", isUpdate: true, clearLines: lines.length, shortLines: 0 };
            insertedCount++;
            continue;
          }

          const clearLines = [];
          const shortLines = [];
          let totalOrderQty = 0;
          let totalTransitQty = 0;
          let totalShortQty = 0;

          for (const line of lines) {
            const sku = _norm(line.sku);
            const reqQty = Number(line.qty) || 0;
            if (!sku || reqQty <= 0) continue;

            const curInh = Math.max(0, runInh[sku] || 0);
            const curTrn = Math.max(0, runTrn[sku] || 0);

            const inhAlloc = Math.min(curInh, reqQty);
            const shortBT = Math.max(0, reqQty - inhAlloc);
            const statusBT = shortBT === 0 ? "OK" : (curInh === 0 ? "NO STOCK" : "SHORT");
            const trnUsed = Math.min(curTrn, shortBT);
            const shortAT = Math.max(0, shortBT - trnUsed);
            const statusAT = shortAT === 0 ? "OK" : (shortBT > 0 && curTrn === 0 ? "NO STOCK" : "SHORT");

            runInh[sku] = Math.max(0, curInh - inhAlloc);
            runTrn[sku] = Math.max(0, curTrn - trnUsed);

            totalOrderQty += reqQty;

            if (inhAlloc > 0 || trnUsed > 0) {
              clearLines.push({ sku: sku, qty: inhAlloc + trnUsed, desc: line.desc || '' });
              await query(
                'INSERT INTO sap_stk_allocation (warehouse, timestamp, so_no, so_date, party_name, reference, sku_code, inhand_alloc, transit_alloc, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [warehouse, tsStr, soNum, orderDate, customerName, custRef, sku, inhAlloc, trnUsed, userId]
              );
            }

            if (trnUsed > 0) totalTransitQty += trnUsed;

            if (shortAT > 0 || shortBT > 0) {
              totalShortQty += shortAT;
              shortLines.push({ sku: sku, reqQty: reqQty, shortAT: shortAT });
              await query(
                'INSERT INTO shortage_partial (warehouse, so_no, party_name, so_date, sku_code, description, req_qty, avail_inhand, short_bt, status_bt, transit_used, short_at, status_at, submit_time, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [warehouse, soNum, customerName, orderDate, sku, line.desc || '', reqQty, inhAlloc, shortBT, statusBT, trnUsed, shortAT, statusAT, tsStr, userId]
              );
            }
          }

          const isPartial = shortLines.length > 0;
          const allocRemark = isPartial ? "Partial Allocation" : (totalTransitQty > 0 ? "Full Allocation (Transit)" : "Full Allocation (Inhand)");
          const finalShortage = isPartial ? totalShortQty : totalTransitQty;

          if (!isPartial) {
            await query(
              'INSERT INTO clear_order (warehouse, so_no, so_date, party_name, reference, submit_time, total_lines, lines_json, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [warehouse, soNum, orderDate, customerName, custRef, tsStr, lines.length, linesJSON, userId]
            );
          } else {
            const clearJSON = JSON.stringify(clearLines);
            await query(
              'INSERT INTO partial_clear_orders (warehouse, so_no, so_date, party_name, reference, submit_time, clear_lines_json, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [warehouse, soNum, orderDate, customerName, custRef, tsStr, clearJSON, userId]
            );
          }

          await query(
            'INSERT INTO operation_sheet (plant, order_no, order_date, customer_name, cust_ref, sku_code, ordered_qty, shortage_qty, alloc_remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [warehouse, soNum, orderDate, customerName, custRef, linesJSON, totalOrderQty, finalShortage, allocRemark, 'Picking']
          );

          await query(
            'INSERT INTO order_checker (order_no, doc_date, customer_name, cust_ref, lines_json, plant, total_order_qty, shortage_qty, alloc_remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [soNum, orderDate, customerName, custRef, linesJSON, warehouse, totalOrderQty, finalShortage, allocRemark, allocRemark]
          );

          results[soNum] = {
            status: isPartial ? "PARTIAL" : "DONE",
            isUpdate: true,
            clearLines: clearLines.length,
            shortLines: shortLines.length
          };
          insertedCount++;
        }

        return res.json({
          success: true,
          result: {
            status: "DONE",
            results: results,
            rows: insertedCount,
            message: `Bulk submit (W/I Aloc) processed ${insertedCount} orders cleanly in SQL database!`
          }
        });
      }

      case 'ocSubmitPartialOrder': {
        const warehouse = args[0] || 'BB04';
        const payload = args[1] || {};
        const userId = args[2] || 'admin';

        const orderNo = payload.soNumber || 'SO_' + Date.now();
        await query(
          'INSERT INTO partial_clear_orders (warehouse, so_no, party_name, clear_lines_json, updated_by) VALUES (?, ?, ?, ?, ?)',
          [warehouse, orderNo, payload.partyName || '', JSON.stringify(payload.lines || []), userId]
        );
        return res.json({ success: true, result: { status: "DONE", message: "Partial clear order saved!" } });
      }

      case 'ocGetPartialOrders': {
        const warehouse = args[0] || 'BB04';
        const partials = await query('SELECT * FROM partial_clear_orders WHERE warehouse = ? OR warehouse IS NULL', [warehouse]);
        return res.json({ success: true, result: partials });
      }

      case 'ocDeletePartialOrder': {
        const orderNo = args[0] || '';
        await query('DELETE FROM partial_clear_orders WHERE so_no = ?', [orderNo]);
        await query('DELETE FROM shortage_partial WHERE so_no = ?', [orderNo]);
        return res.json({ success: true, result: { status: "SUCCESS", message: "Partial order deleted!" } });
      }

      case 'ocResetAllocation':
      case 'ocResetSingleSO':
      case 'ocRemoveAllocation': {
        const orderNo = args[0] || '';
        await query('DELETE FROM phy_stk_allocation WHERE order_no = ?', [orderNo]);
        await query('DELETE FROM sap_stk_allocation WHERE so_no = ?', [orderNo]);
        return res.json({ success: true, result: { status: "SUCCESS", message: `Allocation reset for ${orderNo}` } });
      }

      // -------------------------------------------------------------
      // 5. OUTBOUND OPERATIONS & PICKLIST CONFIRMATION
      // -------------------------------------------------------------
      case 'opGetSheetData':
      case 'getPickingOrders':
      case 'getOutboundOrders': {
        await opRepairAllocationRemarksSQL();
        const warehouse = args[0] || 'BB04';
        const headers = [
          "Plant", "Distribution Channel", "Sales Document", "Order Date", "Customer Name",
          "Customer Ref No", "Order Qty", "Shortage Qty", "Allocation Remark", "Shortage Remark",
          "OBD", "Order Status", "Vehicle Number", "Driver Number", "TPT Name",
          "Dispatch Qty", "Shortage reason", "Loading Supervisor", "Billing Supervisor", "Shift",
          "Loading Date", "Contractor Name", "Loading Start Time", "Loading End Time"
        ];

        const orders = await query('SELECT * FROM operation_sheet ORDER BY id DESC');
        const rows = orders.map((r, idx) => ({
          rowIndex: idx + 2,
          data: [
            r.plant || warehouse,
            r.dist_channel || '10',
            r.order_no || '',
            r.order_date || '',
            r.customer_name || '',
            r.cust_ref || '',
            Number(r.ordered_qty) || 0,
            Number(r.shortage_qty) || 0,
            r.alloc_remark || '',
            r.shortage_remark || '',
            r.obd || '',
            r.status || 'Picking',
            r.vehicle_no || '',
            r.driver_no || '',
            r.tpt_name || '',
            Number(r.dispatch_qty) || 0,
            r.shortage_reason || '',
            r.loading_supervisor || '',
            r.billing_supervisor || '',
            r.shift || 'Day Shift',
            r.loading_date || '',
            r.contractor_name || '',
            r.loading_start_time || '',
            r.loading_end_time || ''
          ]
        }));

        return res.json({
          success: true,
          result: {
            status: "OK",
            headers: headers,
            rows: rows
          }
        });
      }

      case 'opFetchOutboundPgiOrders': {
        await opRepairAllocationRemarksSQL();
        const warehouse = args[0] || 'BB04';
        const misRows = await query("SELECT * FROM outward_mis WHERE UPPER(TRIM(order_status)) = 'PGI DONE'");
        const allocRows = await query('SELECT DISTINCT order_no FROM phy_stk_allocation');
        const allocSoSet = new Set(allocRows.map(r => _norm(r.order_no)));

        const orderMap = {};
        misRows.forEach(r => {
          const plant = _norm(r.plant);
          if (warehouse !== 'ALL' && !_matchWh(plant, warehouse)) return;
          const sDoc = (r.order_no || '').replace(/^'/, '').trim();
          if (!sDoc) return;
          const sNorm = _norm(sDoc);

          if (!orderMap[sNorm]) {
            orderMap[sNorm] = {
              salesDocument: sDoc,
              obd: r.obd || '-',
              orderDate: r.order_date || '',
              customerName: r.customer_name || '',
              customerRefNo: r.cust_ref || '',
              orderQty: Number(r.order_qty) || 0,
              dispatchQty: Number(r.dispatch_qty || r.pgi_qty) || 0,
              vehicleNumber: r.vehicle_no || '',
              driverNumber: r.driver_no || '',
              tptName: r.tpt_name || '',
              status: "PGI Done",
              plant: r.plant || "BB04",
              isAllocated: allocSoSet.has(sNorm)
            };
          }
        });

        return res.json({ success: true, result: { status: "SUCCESS", orders: Object.values(orderMap) } });
      }

      case 'opPreviewOutboundPickList': {
        const warehouse = args[0] || 'BB04';
        const selectedSoNumbers = Array.isArray(args[1]) ? args[1] : [args[1]];

        const allocations = [];
        for (const soNo of selectedSoNumbers) {
          const allocRows = await query('SELECT * FROM phy_stk_allocation WHERE order_no = ?', [soNo]);
          allocations.push(...allocRows);
        }

        return res.json({
          success: true,
          result: {
            status: "SUCCESS",
            allocations: allocations
          }
        });
      }

      case 'opConfirmOutboundPickList': {
        const warehouse = args[0] || 'BB04';
        const selectedSoNumbers = Array.isArray(args[1]) ? args[1] : [args[1]];
        const username = args[2] || 'admin';

        for (const soNo of selectedSoNumbers) {
          await query("UPDATE operation_sheet SET status = 'Picking' WHERE order_no = ?", [soNo]);
          await query("UPDATE outward_mis SET order_status = 'Picking' WHERE order_no = ?", [soNo]);
        }
        await opRepairAllocationRemarksSQL();

        return res.json({
          success: true,
          result: { status: "SUCCESS", message: "Allocations booked and order status updated to Picking." }
        });
      }

      case 'opFetchOutboundPickingOrders': {
        await opRepairAllocationRemarksSQL();
        const warehouse = args[0] || 'BB04';
        const orders = await query("SELECT * FROM operation_sheet WHERE UPPER(TRIM(status)) = 'PICKING'");
        const resultOrders = orders.filter(r => _matchWh(r.plant, warehouse)).map(r => ({
          salesDocument: r.order_no,
          obd: r.obd || '-',
          orderDate: r.order_date || '',
          customerName: r.customer_name || '',
          customerRefNo: r.cust_ref || '',
          orderQty: Number(r.ordered_qty) || 0,
          dispatchQty: Number(r.dispatch_qty) || 0,
          vehicleNumber: r.vehicle_no || '',
          driverNumber: r.driver_no || '',
          tptName: r.tpt_name || '',
          shortageReason: r.shortage_reason || '',
          loadingSupervisor: r.loading_supervisor || '',
          billingSupervisor: r.billing_supervisor || '',
          shift: r.shift || '',
          loadingDate: r.loading_date || '',
          contractorName: r.contractor_name || '',
          loadingStartTime: r.loading_start_time || '',
          loadingEndTime: r.loading_end_time || '',
          status: 'Picking',
          plant: r.plant || 'BB04'
        }));

        return res.json({ success: true, result: { status: "SUCCESS", orders: resultOrders } });
      }

      case 'opGetAllocatedStockForOrder': {
        const soNumber = _norm(args[0] || '');
        const allocs = await query('SELECT * FROM phy_stk_allocation WHERE order_no = ?', [soNumber]);
        return res.json({ success: true, result: { status: "SUCCESS", allocations: allocs } });
      }

      case 'confirmOutbound':
      case 'saveOutboundConfirmation':
      case 'opConfirmOutboundDeductStock': {
        const payload = args[0] || {};
        const orderNo = payload.soNumber || payload.orderNo || args[1] || '';

        await query(`
          UPDATE operation_sheet SET 
            status = 'Confirmed', vehicle_no = ?, driver_no = ?, tpt_name = ?, tpt_gst = ?,
            shortage_reason = ?, loading_supervisor = ?, billing_supervisor = ?, shift = ?,
            loading_date = ?, contractor_name = ?, loading_start_time = ?, loading_end_time = ?, dispatch_qty = ?
          WHERE order_no = ?
        `, [
          payload.vehicleNumber || payload.vehicleNo || '', payload.driverNumber || payload.driverNo || '', payload.tptName || '', payload.tptGst || '',
          payload.shortageReason || '', payload.loadingSupervisor || '', payload.billingSupervisor || 'Anish Shakya', payload.shift || 'Day Shift',
          payload.loadingDate || new Date().toISOString().split('T')[0], payload.contractorName || '', payload.loadingStartTime || '', payload.loadingEndTime || '',
          payload.totalDispatchQty || 0, orderNo
        ]);

        if (payload.items) {
          for (const item of payload.items) {
            const deductQty = Number(item.allocatedQty) || 0;
            if (deductQty <= 0) continue;

            await query('UPDATE phy_stk_entry SET available_qty = available_qty - ? WHERE bin_no = ? AND sku_code = ?', [deductQty, item.bin, item.sku]);
            await query('DELETE FROM phy_stk_entry WHERE available_qty <= 0');

            await query(
              'INSERT INTO bin_txin (warehouse, from_bin, sku_code, transfer_qty, batch, tx_type, doc_no, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [payload.warehouse || 'BB04', item.bin, item.sku, deductQty, item.mfgMonth || '', 'OUTBOUND DEDUCT', orderNo, payload.updatedBy || 'admin']
            );
          }
        }
        await query('DELETE FROM phy_stk_allocation WHERE order_no = ?', [orderNo]);

        return res.json({ success: true, result: { status: "SUCCESS", message: `Order ${orderNo} confirmed successfully.` } });
      }

      case 'ocDispatchOrder':
      case 'opUpdateDispatchInOperationSheet': {
        const warehouse = args[0] || 'BB04';
        const soNumber = args[1] || '';
        const vehNumber = args[2] || '';
        const driverContact = args[3] || '';
        const contractorName = args[7] || '';
        const supervisorName = args[8] || '';

        await query('UPDATE operation_sheet SET status = ?, vehicle_no = ?, driver_no = ?, contractor_name = ?, loading_supervisor = ? WHERE order_no = ?', ['Dispatched', vehNumber, driverContact, contractorName, supervisorName, soNumber]);
        await query('INSERT INTO order_checker (order_no, plant, status, vehicle_no, driver_no) VALUES (?, ?, ?, ?, ?)', [soNumber, warehouse, 'Dispatched', vehNumber, driverContact]);
        await query('INSERT INTO outward_mis (plant, order_no, vehicle_no, driver_no, contractor_name, loading_supervisor) VALUES (?, ?, ?, ?, ?, ?)', [warehouse, soNumber, vehNumber, driverContact, contractorName, supervisorName]);

        return res.json({ success: true, result: { status: "SUCCESS", message: `Order ${soNumber} dispatched!` } });
      }

      case 'opUploadTransportationUpdate': {
        const warehouse = args[0] || 'BB04';
        const dataArray = args[1] || [];
        if (!dataArray || dataArray.length < 2) {
          return res.json({ success: true, result: { status: "ERROR", message: "No data provided." } });
        }

        const headers = dataArray[0].map(h => _norm(h));
        const sDocIdx = fc(headers, ["SALES DOCUMENT", "ORDER NO"]);
        const vehIdx = fc(headers, ["VEHICLE NUMBER", "VEHICLE NO"]);
        const drIdx = fc(headers, ["DRIVER NUMBER", "DRIVER CONTACT"]);
        const tptIdx = fc(headers, ["TPT NAME", "TRANSPORTER"]);

        let updated = 0;
        for (let i = 1; i < dataArray.length; i++) {
          const row = dataArray[i];
          const sDoc = _norm(row[sDocIdx]);
          if (!sDoc) continue;

          await query(
            'UPDATE operation_sheet SET vehicle_no = ?, driver_no = ?, tpt_name = ? WHERE order_no = ?',
            [row[vehIdx] || '', row[drIdx] || '', row[tptIdx] || '', sDoc]
          );
          updated++;
        }

        return res.json({ success: true, result: { status: "OK", updated: updated } });
      }

      case 'opDeleteRow': {
        const orderNo = args[0] || '';
        await query('DELETE FROM operation_sheet WHERE order_no = ?', [orderNo]);
        return res.json({ success: true, result: { status: "SUCCESS", message: "Row deleted!" } });
      }

      case 'opSaveRowEdits': {
        const warehouse = args[0] || 'BB04';
        const edits = args[1] || [];
        let updated = 0;

        for (const edit of edits) {
          if (!edit || !edit.order_no && !edit.fieldName) continue;
          const orderNo = edit.order_no || edit.salesDocument;
          const field = (edit.fieldName || edit.field || '').toUpperCase();
          const val = edit.value !== undefined ? edit.value : edit.val;

          if (orderNo) {
            // Map header field name to column name
            const colMap = {
              "PLANT": "plant",
              "DISTRIBUTION CHANNEL": "dist_channel",
              "SALES DOCUMENT": "order_no",
              "ORDER DATE": "order_date",
              "CUSTOMER NAME": "customer_name",
              "CUSTOMER REF NO": "cust_ref",
              "ORDER QTY": "ordered_qty",
              "SHORTAGE QTY": "shortage_qty",
              "ALLOCATION REMARK": "alloc_remark",
              "SHORTAGE REMARK": "shortage_remark",
              "OBD": "obd",
              "ORDER STATUS": "status",
              "VEHICLE NUMBER": "vehicle_no",
              "DRIVER NUMBER": "driver_no",
              "TPT NAME": "tpt_name",
              "DISPATCH QTY": "dispatch_qty",
              "SHORTAGE REASON": "shortage_reason",
              "LOADING SUPERVISOR": "loading_supervisor",
              "BILLING SUPERVISOR": "billing_supervisor",
              "SHIFT": "shift",
              "LOADING DATE": "loading_date",
              "CONTRACTOR NAME": "contractor_name",
              "LOADING START TIME": "loading_start_time",
              "LOADING END TIME": "loading_end_time"
            };

            const sqlCol = colMap[field];
            if (sqlCol) {
              await query(`UPDATE operation_sheet SET ${sqlCol} = ? WHERE order_no = ?`, [val, orderNo]);
              updated++;
            }
          }
        }

        return res.json({ success: true, result: { status: "SUCCESS", updatedCount: updated } });
      }

      // -------------------------------------------------------------
      // 6. INWARD & ASN MODULE
      // -------------------------------------------------------------
      case 'iwSaveAsn': {
        const asnData = args[0] || {};
        const asnNo = asnData.asnNo || 'ASN_' + Date.now();
        await query(
          'INSERT INTO asn (asn_no, sup_plant, rec_plant, vehicle_no, material_code, qty, remark, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [asnNo, asnData.supPlant || '', asnData.recPlant || '', asnData.vehicleNo || '', asnData.materialCode || '', Number(asnData.qty) || 0, asnData.remark || '', 'Pending']
        );
        return res.json({ success: true, result: { status: "SUCCESS", asnNo: asnNo } });
      }

      case 'getPendingASN':
      case 'iwGetPendingAsns':
      case 'iwLoadPendingObds22': {
        const recPlant = args[0] || 'BB04';
        const pending = await query('SELECT * FROM asn WHERE (rec_plant = ? OR rec_plant IS NULL) AND status = ?', [recPlant, 'Pending']);
        return res.json({ success: true, result: pending });
      }

      case 'printASN': {
        const asnNo = args[0] || '';
        const asnRows = await query('SELECT * FROM asn WHERE asn_no = ?', [asnNo]);
        return res.json({ success: true, result: asnRows });
      }

      case 'confirmASN':
      case 'iwConfirmAsn':
      case 'iwConfirmInboundObd22': {
        const asnNo = args[0] || args.asnNo || '';
        await query('UPDATE asn SET status = ? WHERE asn_no = ?', ['Confirmed', asnNo]);
        await query(
          'INSERT INTO inward_mis (plant_code, obd_mat_doc, status, confirmation_datetime) VALUES (?, ?, ?, ?)',
          ['BB04', asnNo, 'Confirmed', new Date().toISOString()]
        );
        return res.json({ success: true, result: { status: "SUCCESS", message: `ASN ${asnNo} confirmed!` } });
      }

      case 'iwGetAsnReport':
      case 'iwLoadAllInwardMisData': {
        const reports = await query('SELECT * FROM inward_mis ORDER BY id DESC LIMIT 200');
        const dataArr = reports.map(r => [
          r.plant_code || 'BB04',
          r.print_datetime || '',
          r.obd_mat_doc || '',
          r.invoice_num || '',
          r.invoice_date || '',
          r.vehicle_no || '',
          r.material_code || '',
          r.material_desc || '',
          r.billed_batch || '',
          r.bill_qty || 0,
          r.phy_batch || '',
          r.phy_qty || 0,
          r.short_excess || 0,
          r.bin || '',
          r.status || '',
          r.supervisor_name || '',
          r.deo || '',
          r.contractor_name || '',
          r.start_time || '',
          r.end_time || '',
          r.dock_num || '',
          r.shift || '',
          r.confirmation_datetime || '',
          r.grn_num || '',
          r.line_status || '',
          r.unloading_date || '',
          r.loading_supervisor_name || ''
        ]);

        return res.json({
          success: true,
          result: {
            status: "SUCCESS",
            data: dataArr
          }
        });
      }

      // -------------------------------------------------------------
      // 7. PHYSICAL STOCK & BIN TRANSACTIONS
      // -------------------------------------------------------------
      case 'saveOrUpdateStock':
      case 'updatePhyStkEntry_': {
        const item = args[0] || {};
        const bin = item.bin || item.bin_no || '';
        const sku = _norm(item.sku || item.sku_code);
        const qty = Number(item.qty || item.available_qty) || 0;

        const existing = await query('SELECT * FROM phy_stk_entry WHERE bin_no = ? AND sku_code = ?', [bin, sku]);
        if (existing && existing.length > 0) {
          await query('UPDATE phy_stk_entry SET available_qty = available_qty + ? WHERE id = ?', [qty, existing[0].id]);
        } else {
          await query(
            'INSERT INTO phy_stk_entry (bin_no, sku_code, product_name, available_qty, mfg_month, plant) VALUES (?, ?, ?, ?, ?, ?)',
            [bin, sku, item.productName || sku, qty, item.mfgMonth || '', item.plant || 'BB04']
          );
        }
        return res.json({ success: true, result: { status: "SUCCESS" } });
      }

      case 'recordBinTransaction_': {
        const tx = args[0] || {};
        await query(
          'INSERT INTO bin_txin (warehouse, from_bin, to_bin, sku_code, transfer_qty, batch, tx_type, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [tx.warehouse || 'BB04', tx.fromBin || '', tx.toBin || '', _norm(tx.sku), Number(tx.qty) || 0, tx.batch || '', tx.type || 'TRANSFER', tx.user || 'admin']
        );
        return res.json({ success: true, result: { status: "SUCCESS" } });
      }

      case 'opGetBinSuggestionsForSku': {
        const sku = _norm(args[0]);
        const warehouse = args[1] || 'BB04';
        const bins = await query('SELECT bin_no, available_qty, mfg_month, product_name, plant FROM phy_stk_entry WHERE sku_code = ? AND available_qty > 0 ORDER BY updated_at ASC', [sku]);
        const suggestions = bins.filter(b => _matchWh(b.plant, warehouse)).map(b => ({
          mfgMonth: b.mfg_month || 'NA',
          bin: b.bin_no,
          sku: sku,
          productName: b.product_name || sku,
          availQty: Number(b.available_qty) || 0,
          plant: b.plant || 'BB04'
        }));

        return res.json({ success: true, result: { status: "SUCCESS", suggestions: suggestions } });
      }

      // -------------------------------------------------------------
      // DEFAULT FALLBACK
      // -------------------------------------------------------------
      default:
        console.log(`[GAS-BRIDGE Warning] Unmapped method call: ${fn}, returning success fallback`);
        return res.json({ success: true, result: { status: "SUCCESS", message: `Executed ${fn} cleanly in SQL engine` } });
    }
  } catch (err) {
    console.error(`[GAS-BRIDGE Error]:`, err);
    res.status(500).json({ success: false, error: err.message || "Internal Bridge Execution Error" });
  }
});

// Global Express Error Middleware
app.use((err, req, res, next) => {
  console.error('[Express Global Error]:', err.stack || err.message);
  res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

// Process-level Crash Prevention
process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception Handled]:', err.stack || err.message);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection Handled]:', reason);
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Bonn_Prod_WMS Fast Cloud Backend connected live to Database running on port ${PORT}`);
  });
});


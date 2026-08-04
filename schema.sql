-- Clean Drop & Fresh Creation Schema for Supabase PostgreSQL & SQLite
-- Ensures all columns (including plant, dist_channel, etc.) are created cleanly without column missing errors

DROP TABLE IF EXISTS user_auth CASCADE;
DROP TABLE IF EXISTS party_master CASCADE;
DROP TABLE IF EXISTS wh_masters CASCADE;
DROP TABLE IF EXISTS bin_masters CASCADE;
DROP TABLE IF EXISTS sku_masters CASCADE;
DROP TABLE IF EXISTS mail_masters CASCADE;
DROP TABLE IF EXISTS sap_stk_dump CASCADE;
DROP TABLE IF EXISTS sap_stk_allocation CASCADE;
DROP TABLE IF EXISTS partial_clear_orders CASCADE;
DROP TABLE IF EXISTS shortage_partial CASCADE;
DROP TABLE IF EXISTS clear_order CASCADE;
DROP TABLE IF EXISTS order_checker CASCADE;
DROP TABLE IF EXISTS operation_sheet CASCADE;
DROP TABLE IF EXISTS phy_stk_allocation CASCADE;
DROP TABLE IF EXISTS phy_stk_entry CASCADE;
DROP TABLE IF EXISTS bin_txin CASCADE;
DROP TABLE IF EXISTS outward_mis CASCADE;
DROP TABLE IF EXISTS inward_mis CASCADE;
DROP TABLE IF EXISTS asn CASCADE;

-- 1. USER_AUTH
CREATE TABLE user_auth (
    "User ID" TEXT PRIMARY KEY,
    "Name" TEXT,
    "Password" TEXT,
    "Assigned Warehouses" TEXT,
    "Admin_UserAuth" TEXT DEFAULT 'NO', "Admin_ActivityLog" TEXT DEFAULT 'NO', "Admin_ResetData" TEXT DEFAULT 'NO',
    "Setup_BinMaster" TEXT DEFAULT 'NO', "Setup_ProductMaster" TEXT DEFAULT 'NO',
    "Sales_StkDump" TEXT DEFAULT 'NO', "Sales_OrderChecker" TEXT DEFAULT 'NO', "Sales_ShortageChecker" TEXT DEFAULT 'NO', "Sales_AllocationView" TEXT DEFAULT 'NO', "Sales_ConfirmOutbound" TEXT DEFAULT 'NO',
    "Receipts_ASN" TEXT DEFAULT 'NO', "Receipts_CreateInbound" TEXT DEFAULT 'NO', "Receipts_ConfirmInbound" TEXT DEFAULT 'NO', "Receipts_InboundReport" TEXT DEFAULT 'NO',
    "Inventory_Reconciliation" TEXT DEFAULT 'NO', "Inventory_Enquiry" TEXT DEFAULT 'NO', "Inventory_Reports" TEXT DEFAULT 'NO'
);

-- 1b. SESSIONS (Single Device Login Enforcement)
DROP TABLE IF EXISTS sessions CASCADE;
CREATE TABLE sessions (
    user_id TEXT PRIMARY KEY,
    session_token TEXT,
    last_login TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    device_id TEXT
);


-- 2. PARTY_MASTER
CREATE TABLE party_master (
    id SERIAL PRIMARY KEY,
    contractor_name TEXT,
    supervisor_name TEXT,
    tpt_name TEXT,
    tpt_gst TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. WH_MASTERS
CREATE TABLE wh_masters (
    wh_code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    plant TEXT,
    sloc TEXT,
    location TEXT,
    is_active INT DEFAULT 1
);

-- 4. BIN_MASTERS
CREATE TABLE bin_masters (
    bin_code TEXT PRIMARY KEY,
    wh_code TEXT,
    zone TEXT,
    type TEXT,
    max_capacity NUMERIC(10,2) DEFAULT 1000,
    status TEXT DEFAULT 'Available'
);

-- 5. SKU_MASTERS
CREATE TABLE sku_masters (
    sku_code TEXT PRIMARY KEY,
    sku_name TEXT NOT NULL,
    description TEXT,
    uom TEXT DEFAULT 'PCS',
    plant TEXT,
    sloc TEXT,
    category TEXT,
    unit_weight_kg NUMERIC(10,3) DEFAULT 0.4
);

-- 6. MAIL_MASTERS
CREATE TABLE mail_masters (
    id SERIAL PRIMARY KEY,
    module TEXT,
    email TEXT,
    warehouse TEXT,
    short_excess_mail TEXT DEFAULT 'NO',
    remark_trail_mail TEXT DEFAULT 'NO'
);

-- 7. SAP_STK_DUMP
CREATE TABLE sap_stk_dump (
    id SERIAL PRIMARY KEY,
    warehouse TEXT,
    sloc TEXT,
    material_code TEXT,
    material_desc TEXT,
    batch_json TEXT,
    total_unrestricted NUMERIC(10,2) DEFAULT 0,
    total_transit NUMERIC(10,2) DEFAULT 0,
    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 8. SAP_STK_ALLOCATION
CREATE TABLE sap_stk_allocation (
    id SERIAL PRIMARY KEY,
    warehouse TEXT,
    timestamp TEXT,
    so_no TEXT,
    so_date TEXT,
    party_name TEXT,
    reference TEXT,
    sku_code TEXT,
    inhand_alloc NUMERIC(10,2) DEFAULT 0,
    transit_alloc NUMERIC(10,2) DEFAULT 0,
    updated_by TEXT
);

-- 9. PARTIAL_CLEAR_ORDERS
CREATE TABLE partial_clear_orders (
    id SERIAL PRIMARY KEY,
    warehouse TEXT,
    so_no TEXT,
    so_date TEXT,
    party_name TEXT,
    reference TEXT,
    submit_time TEXT,
    clear_lines_json TEXT,
    obd TEXT,
    pgi TEXT,
    updated_by TEXT
);

-- 10. SHORTAGE_PARTIAL
CREATE TABLE shortage_partial (
    id SERIAL PRIMARY KEY,
    warehouse TEXT,
    so_no TEXT,
    party_name TEXT,
    so_date TEXT,
    sku_code TEXT,
    description TEXT,
    req_qty NUMERIC(10,2) DEFAULT 0,
    avail_inhand NUMERIC(10,2) DEFAULT 0,
    short_bt NUMERIC(10,2) DEFAULT 0,
    status_bt TEXT,
    transit_used NUMERIC(10,2) DEFAULT 0,
    short_at NUMERIC(10,2) DEFAULT 0,
    status_at TEXT,
    submit_time TEXT,
    updated_by TEXT
);

-- 11. CLEAR_ORDER
CREATE TABLE clear_order (
    id SERIAL PRIMARY KEY,
    warehouse TEXT,
    so_no TEXT,
    so_date TEXT,
    party_name TEXT,
    reference TEXT,
    submit_time TEXT,
    obd TEXT,
    pgi TEXT,
    total_lines INT DEFAULT 0,
    lines_json TEXT,
    dump_updated_post_pgi TEXT DEFAULT 'NO',
    updated_by TEXT
);

-- 12. ORDER_CHECKER
CREATE TABLE order_checker (
    id SERIAL PRIMARY KEY,
    order_no TEXT,
    doc_date TEXT,
    sold_to_party TEXT,
    customer_name TEXT,
    cust_ref TEXT,
    lines_json TEXT,
    plant TEXT,
    total_order_qty NUMERIC(10,2) DEFAULT 0,
    shortage_qty NUMERIC(10,2) DEFAULT 0,
    alloc_remark TEXT,
    shortage_remark TEXT,
    status TEXT,
    vehicle_no TEXT,
    driver_no TEXT,
    tpt_name TEXT,
    dispatch_time TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 13. OPERATION_SHEET
CREATE TABLE operation_sheet (
    id SERIAL PRIMARY KEY,
    plant TEXT,
    dist_channel TEXT,
    order_no TEXT UNIQUE NOT NULL,
    order_date TEXT,
    customer_name TEXT,
    cust_ref TEXT,
    sku_code TEXT,
    ordered_qty NUMERIC(10,2) DEFAULT 0,
    shortage_qty NUMERIC(10,2) DEFAULT 0,
    alloc_remark TEXT,
    shortage_remark TEXT,
    obd TEXT,
    status TEXT DEFAULT 'Picking',
    vehicle_no TEXT,
    driver_no TEXT,
    tpt_name TEXT,
    tpt_gst TEXT,
    dispatch_qty NUMERIC(10,2) DEFAULT 0,
    shortage_reason TEXT,
    loading_supervisor TEXT,
    billing_supervisor TEXT,
    shift TEXT,
    loading_date TEXT,
    contractor_name TEXT,
    loading_start_time TEXT,
    loading_end_time TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 14. PHY_STK_ALLOCATION
CREATE TABLE phy_stk_allocation (
    id SERIAL PRIMARY KEY,
    warehouse TEXT,
    timestamp TEXT,
    order_no TEXT NOT NULL,
    sku_code TEXT NOT NULL,
    bin_no TEXT NOT NULL,
    allocated_qty NUMERIC(10,2) DEFAULT 0,
    mfg_month TEXT,
    updated_by TEXT
);

-- 15. PHY_STK_ENTRY
CREATE TABLE phy_stk_entry (
    id SERIAL PRIMARY KEY,
    mfg_month TEXT,
    bin_no TEXT NOT NULL,
    sku_code TEXT NOT NULL,
    product_name TEXT,
    available_qty NUMERIC(10,2) DEFAULT 0,
    computation_logic TEXT,
    plant TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 16. BIN_TXIN
CREATE TABLE bin_txin (
    id SERIAL PRIMARY KEY,
    warehouse TEXT,
    timestamp TEXT,
    from_bin TEXT NOT NULL,
    to_bin TEXT,
    sku_code TEXT NOT NULL,
    transfer_qty NUMERIC(10,2) DEFAULT 0,
    batch TEXT,
    tx_type TEXT,
    doc_no TEXT,
    performed_by TEXT
);

-- 17. OUTWARD_MIS
CREATE TABLE outward_mis (
    id SERIAL PRIMARY KEY,
    plant TEXT,
    order_no TEXT,
    order_date TEXT,
    customer_name TEXT,
    cust_ref TEXT,
    order_qty NUMERIC(10,2) DEFAULT 0,
    shortage_qty NUMERIC(10,2) DEFAULT 0,
    alloc_remark TEXT,
    shortage_remark TEXT,
    order_status TEXT,
    vehicle_no TEXT,
    driver_no TEXT,
    tpt_name TEXT,
    sku_code TEXT,
    description TEXT,
    batch TEXT,
    pgi_qty NUMERIC(10,2) DEFAULT 0,
    dispatch_qty NUMERIC(10,2) DEFAULT 0,
    shortage_reason TEXT,
    loading_supervisor TEXT,
    billing_supervisor TEXT,
    shift TEXT,
    loading_date TEXT,
    contractor_name TEXT,
    loading_start_time TEXT,
    loading_end_time TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 18. INWARD_MIS
CREATE TABLE inward_mis (
    id SERIAL PRIMARY KEY,
    plant_code TEXT,
    print_datetime TEXT,
    obd_mat_doc TEXT,
    invoice_num TEXT,
    invoice_date TEXT,
    vehicle_no TEXT,
    material_code TEXT,
    material_desc TEXT,
    billed_batch TEXT,
    bill_qty NUMERIC(10,2) DEFAULT 0,
    phy_batch TEXT,
    phy_qty NUMERIC(10,2) DEFAULT 0,
    short_excess NUMERIC(10,2) DEFAULT 0,
    bin TEXT,
    status TEXT,
    supervisor_name TEXT,
    deo TEXT,
    contractor_name TEXT,
    start_time TEXT,
    end_time TEXT,
    dock_num TEXT,
    shift TEXT,
    confirmation_datetime TEXT,
    grn_num TEXT,
    line_status TEXT,
    unloading_date TEXT,
    loading_supervisor_name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 19. ASN
CREATE TABLE asn (
    id SERIAL PRIMARY KEY,
    asn_datetime TEXT,
    asn_no TEXT UNIQUE NOT NULL,
    sup_plant TEXT,
    rec_plant TEXT,
    vehicle_no TEXT,
    material_code TEXT,
    qty NUMERIC(10,2) DEFAULT 0,
    remark TEXT,
    invoice_num TEXT,
    invoice_date TEXT,
    material_desc TEXT,
    billed_batch TEXT,
    loading_supervisor TEXT,
    status TEXT DEFAULT 'Pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for lightning fast lookups
CREATE INDEX IF NOT EXISTS idx_op_status ON operation_sheet(status);
CREATE INDEX IF NOT EXISTS idx_op_plant ON operation_sheet(plant);
CREATE INDEX IF NOT EXISTS idx_alloc_order ON phy_stk_allocation(order_no);
CREATE INDEX IF NOT EXISTS idx_stk_sku_bin ON phy_stk_entry(sku_code, bin_no);
CREATE INDEX IF NOT EXISTS idx_dump_mat ON sap_stk_dump(material_code, warehouse);
CREATE INDEX IF NOT EXISTS idx_asn_no ON asn(asn_no);

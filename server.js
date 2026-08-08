const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const port = 5000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
const compression = require('compression');
app.use(compression());

// ----- Supabase Client Setup -----
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY in .env');
  process.exit(1);
}

// Optional proxy support
let customFetch = undefined;
if (process.env.HTTP_PROXY) {
  const { HttpsProxyAgent } = require('https-proxy-agent');
  const agent = new HttpsProxyAgent(process.env.HTTP_PROXY);
  const fetch = require('node-fetch');
  customFetch = (url, options) => fetch(url, { ...options, agent });
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  fetch: customFetch,
});

console.log('🔌 Connected to Supabase:', supabaseUrl);

// ========== SEED DEFAULT PRODUCTS ==========
async function seedProducts() {
  const { data: existing, error, count } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error('Error checking products:', error.message);
    return;
  }

  if (count === 0) {
   const defaultProducts = [
  { name: 'Chocolate Chip Cookies', price: 4.99, category: 'Biscuit', quantity: 15 },
  { name: 'Butter Shortbread', price: 3.50, category: 'Biscuit', quantity: 10 },
  { name: 'Caramel Fudge', price: 5.25, category: 'Sweet', quantity: 8 },
  { name: 'Almond Biscotti', price: 6.00, category: 'Biscuit', quantity: 12 },
  { name: 'Mint Chocolate Bark', price: 7.20, category: 'Sweet', quantity: 5 },
];

    const { error: insertError } = await supabase
      .from('products')
      .insert(defaultProducts);

    if (insertError) {
      console.error('Error seeding products:', insertError.message);
    } else {
      console.log('✅ Seeded default sweets & biscuits with quantities!');
    }
  }
}

// ========== API ROUTES ==========

// ----- Customers -----
app.get('/api/customers', async (req, res) => {
  const search = req.query.search || '';
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .ilike('name', `%${search}%`)
    .order('name')
    .limit(10);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/customers', async (req, res) => {
  const { name, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });

  const { data, error } = await supabase
    .from('customers')
    .insert({ name, phone: phone || '' })
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
});

// ----- Products -----
app.get('/api/products', async (req, res) => {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('name');

  if (error) return res.status(500).json({ error: error.message });

  const products = data.map(p => ({
    ...p,
    low_stock: (p.quantity || 0) <= 5,
  }));
  res.json(products);
});

app.post('/api/products', async (req, res) => {
  const { name, price, category, image, quantity } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'Name and price are required' });
  }

  const { data, error } = await supabase
    .from('products')
    .insert({
      name,
      price: parseFloat(price),
      category: category || '',
      quantity: parseInt(quantity) || 0,
      // image removed
    })
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data[0]);
});

app.patch('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { name, price, category, quantity, } = req.body;

  const updates = {};
  if (name !== undefined) updates.name = name;
  if (price !== undefined) updates.price = parseFloat(price);
  if (category !== undefined) updates.category = category;
  if (quantity !== undefined) updates.quantity = parseInt(quantity);
 

  const { data, error } = await supabase
    .from('products')
    .update(updates)
    .eq('id', id)
    .select();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;

  // Check if product has sales or loans
  const { data: sales, error: salesErr } = await supabase
    .from('sales')
    .select('id')
    .eq('product_id', id)
    .limit(1);

  if (salesErr) return res.status(500).json({ error: salesErr.message });
  if (sales && sales.length > 0) {
    return res.status(400).json({ error: 'Cannot delete: product has sales' });
  }

  const { data: loans, error: loansErr } = await supabase
    .from('loans')
    .select('id')
    .eq('product_id', id)
    .limit(1);

  if (loansErr) return res.status(500).json({ error: loansErr.message });
  if (loans && loans.length > 0) {
    return res.status(400).json({ error: 'Cannot delete: product has loans' });
  }

  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

app.get('/api/products/check', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const { data, error } = await supabase
    .from('products')
    .select('id, name')
    .ilike('name', name)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || null);
});

// ----- Sales -----
app.post('/api/sales', async (req, res) => {
 const { productId, customerId, amount, quantity, orderId } = req.body;


  if (!productId || !customerId) {
    return res.status(400).json({ error: 'Product and customer are required' });
  }

  const qty = parseInt(quantity) || 1;

  // Get product and check stock
  const { data: product, error: prodErr } = await supabase
    .from('products')
    .select('price, quantity')
    .eq('id', productId)
    .single();

  if (prodErr) return res.status(500).json({ error: prodErr.message });
  if (!product) return res.status(404).json({ error: 'Product not found' });

  if (product.quantity < qty) {
    return res.status(400).json({ error: `Insufficient stock (available: ${product.quantity})` });
  }

  const finalAmount = amount || product.price * qty;

  // Insert sale
  const { data: sale, error: saleErr } = await supabase
    .from('sales')
    .insert({
      product_id: productId,
      customer_id: customerId,
      amount: finalAmount,
      quantity: qty,
    })
    .select(`
      *,
      customers (name, phone),
      products (name, price)
    `);

  if (saleErr) return res.status(500).json({ error: saleErr.message });

  // Update stock
  const newStock = product.quantity - qty;
  await supabase
    .from('products')
    .update({ quantity: newStock })
    .eq('id', productId);
    const saleData = {
    product_id: productId,
    customer_id: customerId,
    amount: finalAmount,
    quantity: qty,
    order_id: orderId || null,
  };

  res.status(201).json(sale[0]);
});

// ----- Sales (with date range) -----
app.get('/api/sales', async (req, res) => {
  const { startDate, endDate } = req.query;
  let query = supabase
    .from('sales')
    .select(`
      *,
      customers (name, phone),
      products (name, price)
    `)
    .order('created_at', { ascending: false });

  if (startDate) {
    query = query.gte('created_at', `${startDate}T00:00:00`);
  }
  if (endDate) {
    query = query.lte('created_at', `${endDate}T23:59:59`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/orders', async (req, res) => {
  const { customerId, orderId, items } = req.body;
  if (!customerId || !items || items.length === 0) {
    return res.status(400).json({ error: 'Customer and items are required' });
  }

  // Validate stock for each item and calculate amounts
  const salesData = [];
  for (const item of items) {
    const { data: product, error } = await supabase
      .from('products')
      .select('price, quantity')
      .eq('id', item.productId)
      .single();
    if (error || !product) {
      return res.status(404).json({ error: `Product ${item.productId} not found` });
    }
    if (product.quantity < item.quantity) {
      return res.status(400).json({ error: `Insufficient stock for product ${item.productId}` });
    }
    const amount = item.amount || product.price * item.quantity;
    salesData.push({
      product_id: item.productId,
      customer_id: customerId,
      amount: amount,
      quantity: item.quantity,
      order_id: orderId,
    });
    // Decrease stock
    await supabase
      .from('products')
      .update({ quantity: product.quantity - item.quantity })
      .eq('id', item.productId);
  }

  // Insert all sales
  const { data, error } = await supabase
    .from('sales')
    .insert(salesData)
    .select();

  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ success: true, sales: data });
});

// ----- Get Order by ID (for receipt) -----
app.get('/api/sales/order/:orderId', async (req, res) => {
  const { orderId } = req.params;
  const { data, error } = await supabase
    .from('sales')
    .select(`
      *,
      customers (name, phone),
      products (name, price)
    `)
    .eq('order_id', orderId);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.get('/api/loans', async (req, res) => {
  const { startDate, endDate } = req.query;
  try {
    let query = supabase
      .from('loans')
      .select(`
        *,
        customers (name, phone),
        products (name, price)
      `)
      .order('created_at', { ascending: false });

    if (startDate) {
      query = query.gte('created_at', `${startDate}T00:00:00`);
    }
    if (endDate) {
      query = query.lte('created_at', `${endDate}T23:59:59`);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('Loans API error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ----- Bulk Import Products -----
app.post('/api/products/bulk', async (req, res) => {
  const { products } = req.body;
  if (!products || !Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: 'No products to import' });
  }

  try {
    // Validate and prepare data
    const productData = products.map(p => ({
      name: p.name.trim(),
      price: parseFloat(p.price),
      category: p.category?.trim() || 'Sweet',
      quantity: parseInt(p.quantity) || 0,
    }));

    // Insert all products
    const { data, error } = await supabase
      .from('products')
      .insert(productData)
      .select();

    if (error) throw error;

    res.status(201).json({
      success: true,
      imported: data.length,
      products: data,
    });
  } catch (err) {
    console.error('Bulk import error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ----- Loans -----
app.post('/api/loans', async (req, res) => {
  const { customerId, productId, amount, due_date, notes, quantity } = req.body;

  if (!customerId || !productId || !amount || amount <= 0) {
    return res.status(400).json({ error: 'Customer, product, and amount > 0 are required' });
  }

  const qty = parseInt(quantity) || 1;

  // 1. Get product and check stock
  const { data: product, error: prodErr } = await supabase
    .from('products')
    .select('quantity')
    .eq('id', productId)
    .single();

  if (prodErr) return res.status(500).json({ error: prodErr.message });
  if (!product) return res.status(404).json({ error: 'Product not found' });

  if (product.quantity < qty) {
    return res.status(400).json({ error: `Insufficient stock (available: ${product.quantity})` });
  }

  // 2. Insert loan
  const { data: loan, error } = await supabase
    .from('loans')
    .insert({
      customer_id: customerId,
      product_id: productId,
      amount: amount,
      remaining: amount,
      due_date: due_date || null,
      notes: notes || null,
      status: 'active',
    })
    .select(`
      *,
      customers (name, phone),
      products (name, price)
    `);

  if (error) return res.status(500).json({ error: error.message });

  // 3. Decrease stock
  const newStock = product.quantity - qty;
  await supabase
    .from('products')
    .update({ quantity: newStock })
    .eq('id', productId);

  res.status(201).json(loan[0]);
});

// --- Get Payments for a Loan ---
app.get('/api/loans/:id/payments', async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('payments')
    .select('*')
    .eq('loan_id', id)
    .order('payment_date', { ascending: false });

  if (error) {
    console.error('Payment fetch error:', error);
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});
app.post('/api/loans/:id/pay', async (req, res) => {
  const { id } = req.params;
  const { amount, notes } = req.body;

  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid amount is required' });
  }

  try {
    // 1. Get the loan
    const { data: loan, error: loanErr } = await supabase
      .from('loans')
      .select('id, amount, remaining, customer_id, product_id, due_date, notes, status')
      .eq('id', id)
      .single();

    if (loanErr || !loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (amount > loan.remaining) {
      return res.status(400).json({ 
        error: `Payment exceeds remaining balance (₦${loan.remaining.toFixed(2)})` 
      });
    }

    // 2. Insert payment
    const { data: payment, error: payErr } = await supabase
      .from('payments')
      .insert({
        loan_id: id,
        amount: amount,
        notes: notes || null,
      })
      .select();

    if (payErr) {
      console.error('Payment insert error:', payErr);
      return res.status(500).json({ error: payErr.message });
    }

    // 3. Update loan
    const newRemaining = loan.remaining - amount;
    const newStatus = newRemaining <= 0.01 ? 'paid' : 'active';

    await supabase
      .from('loans')
      .update({ 
        remaining: newRemaining, 
        status: newStatus 
      })
      .eq('id', id);

    // 4. Fetch updated loan with customer and product info
    const { data: updatedLoan, error: fetchErr } = await supabase
      .from('loans')
      .select(`
        *,
        customers (name, phone),
        products (name, price)
      `)
      .eq('id', id)
      .single();

    if (fetchErr) {
      console.error('Fetch updated loan error:', fetchErr);
      // Return minimal success response
      return res.status(201).json({
        success: true,
        payment: payment[0],
        remaining: newRemaining,
        is_paid: newStatus === 'paid',
        message: 'Payment recorded but loan details could not be refreshed'
      });
    }

    // 5. Get all payments for this loan (to show history)
    const { data: allPayments, error: payHistoryErr } = await supabase
      .from('payments')
      .select('*')
      .eq('loan_id', id)
      .order('payment_date', { ascending: false });

    if (payHistoryErr) {
      console.error('Payment history error:', payHistoryErr);
      // Still return the loan data without payment history
      return res.status(201).json({
        success: true,
        loan: updatedLoan,
        payment: payment[0],
        remaining: newRemaining,
        is_paid: newStatus === 'paid'
      });
    }

    // 6. Return everything
    res.status(201).json({
      success: true,
      loan: updatedLoan,
      payment: payment[0],
      payments: allPayments,
      remaining: newRemaining,
      is_paid: newStatus === 'paid'
    });

  } catch (error) {
    console.error('Payment error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/loans/:id', async (req, res) => {
  const { id } = req.params;

  const { data: loan, error: findErr } = await supabase
    .from('loans')
    .select('id')
    .eq('id', id)
    .single();

  if (findErr || !loan) {
    return res.status(404).json({ error: 'Loan not found' });
  }

  const { error } = await supabase
    .from('loans')
    .delete()
    .eq('id', id);

  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ----- Restock Products -----
app.post('/api/products/restock', async (req, res) => {
  const { productId, quantity } = req.body;
  if (!productId || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'Product ID and quantity > 0 are required' });
  }

  const { data: product, error: getErr } = await supabase
    .from('products')
    .select('quantity')
    .eq('id', productId)
    .single();

  if (getErr) return res.status(500).json({ error: getErr.message });
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const newStock = product.quantity + parseInt(quantity);
  const { error: updateErr } = await supabase
    .from('products')
    .update({ quantity: newStock })
    .eq('id', productId);

  if (updateErr) return res.status(500).json({ error: updateErr.message });
  res.json({ success: true, newStock });
});

// ----- Customers with Balance -----
app.get('/api/customers/with-balance', async (req, res) => {
  // Complex query: aggregate sales and loans for each customer
  // Using raw SQL or multiple queries. We'll do two separate queries and combine.
  try {
    // Get all customers
    const { data: customers, error: cErr } = await supabase
      .from('customers')
      .select('*')
      .order('name');

    if (cErr) throw cErr;

    const result = await Promise.all(customers.map(async (c) => {
      // Sales total
      const { data: sales, error: sErr } = await supabase
        .from('sales')
        .select('amount')
        .eq('customer_id', c.id);

      if (sErr) throw sErr;

      // Loans total
      const { data: loans, error: lErr } = await supabase
        .from('loans')
        .select('amount')
        .eq('customer_id', c.id);

      if (lErr) throw lErr;

      // Payments total (via loans)
      let payments = 0;
      if (loans && loans.length > 0) {
        const loanIds = loans.map(l => l.id);
        const { data: payData, error: pErr } = await supabase
          .from('payments')
          .select('amount')
          .in('loan_id', loanIds);

        if (pErr) throw pErr;
        payments = payData.reduce((sum, p) => sum + p.amount, 0);
      }

      const totalSales = sales.reduce((s, x) => s + x.amount, 0);
      const totalLoans = loans.reduce((s, x) => s + x.amount, 0);

      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        total_sales: totalSales,
        total_loans: totalLoans,
        total_payments: payments,
        net_balance: totalSales - totalLoans + payments, // positive = credit, negative = debt
      };
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ----- Dashboard Stats -----
app.get('/api/dashboard/stats', async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  try {
    // Sales Today
    const { data: salesToday, error: s1 } = await supabase
      .from('sales')
      .select('amount')
      .gte('created_at', `${today}T00:00:00`)
      .lt('created_at', `${today}T23:59:59`);
    if (s1) throw s1;

    // Loans Today
    const { data: loansToday, error: s2 } = await supabase
      .from('loans')
      .select('amount')
      .gte('created_at', `${today}T00:00:00`)
      .lt('created_at', `${today}T23:59:59`);
    if (s2) throw s2;

    // Total Products Value (price * quantity)
    const { data: products, error: s3 } = await supabase
      .from('products')
      .select('price, quantity');
    if (s3) throw s3;
    const totalProductValue = products.reduce((acc, p) => acc + parseFloat(p.price || 0), 0);

    // Total Customers
    const { count: totalCustomers, error: s4 } = await supabase
      .from('customers')
      .select('*', { count: 'exact', head: true });
    if (s4) throw s4;

    // Recent 5 transactions (sales + loans combined)
    const { data: recentSales, error: s5 } = await supabase
      .from('sales')
      .select(`
        *,
        customers (name),
        products (name)
      `)
      .order('created_at', { ascending: false })
      .limit(3);

    if (s5) throw s5;

    const { data: recentLoans, error: s6 } = await supabase
      .from('loans')
      .select(`
        *,
        customers (name),
        products (name)
      `)
      .order('created_at', { ascending: false })
      .limit(3);

    if (s6) throw s6;

    // Combine and sort by date
    const combined = [
      ...recentSales.map(r => ({ ...r, type: 'sale' })),
      ...recentLoans.map(r => ({ ...r, type: 'loan' })),
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

    const sum = (arr) => arr.reduce((acc, item) => acc + item.amount, 0);

    res.json({
      salesToday: sum(salesToday || []),
      loansToday: sum(loansToday || []),
      totalProductValue: totalProductValue, // ✅ now sums price only
      totalCustomers: totalCustomers || 0,
      recentTransactions: combined.map(t => ({
        ...t,
        customer_name: t.customers?.name || 'Unknown',
        product_name: t.products?.name || 'Unknown',
        amount: t.amount,
        type: t.type,
        created_at: t.created_at,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----- History Endpoints -----
app.get('/api/history/sales', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Date is required' });

  const start = `${date}T00:00:00`;
  const end = `${date}T23:59:59`;

  const { data, error } = await supabase
    .from('sales')
    .select('amount, created_at')
    .gte('created_at', start)
    .lte('created_at', end);

  if (error) return res.status(500).json({ error: error.message });

  const grouped = {};
  data.forEach(t => {
    const hour = new Date(t.created_at).getHours();
    if (!grouped[hour]) grouped[hour] = { total: 0, count: 0 };
    grouped[hour].total += t.amount;
    grouped[hour].count += 1;
  });

  const result = Object.keys(grouped).map(hour => ({
    hour: `${String(hour).padStart(2, '0')}:00`,
    total: grouped[hour].total,
    count: grouped[hour].count,
  })).sort((a, b) => parseInt(a.hour) - parseInt(b.hour));

  res.json(result);
});

app.get('/api/history/loans', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Date is required' });

  const start = `${date}T00:00:00`;
  const end = `${date}T23:59:59`;

  const { data, error } = await supabase
    .from('loans')
    .select('amount, created_at')
    .gte('created_at', start)
    .lte('created_at', end);

  if (error) return res.status(500).json({ error: error.message });

  const grouped = {};
  data.forEach(t => {
    const hour = new Date(t.created_at).getHours();
    if (!grouped[hour]) grouped[hour] = { total: 0, count: 0 };
    grouped[hour].total += t.amount;
    grouped[hour].count += 1;
  });

  const result = Object.keys(grouped).map(hour => ({
    hour: `${String(hour).padStart(2, '0')}:00`,
    total: grouped[hour].total,
    count: grouped[hour].count,
  })).sort((a, b) => parseInt(a.hour) - parseInt(b.hour));

  res.json(result);
});

app.get('/api/history/products', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Date is required' });

  const start = `${date}T00:00:00`;
  const end = `${date}T23:59:59`;

  const { data, error } = await supabase
    .from('products')
    .select('price, quantity, created_at')
    .gte('created_at', start)
    .lte('created_at', end);

  if (error) return res.status(500).json({ error: error.message });

  const grouped = {};
  data.forEach(p => {
    const hour = new Date(p.created_at).getHours();
    if (!grouped[hour]) grouped[hour] = { total: 0, count: 0 };
    grouped[hour].total += p.price * (p.quantity || 0);
    grouped[hour].count += 1;
  });

  const result = Object.keys(grouped).map(hour => ({
    hour: `${String(hour).padStart(2, '0')}:00`,
    total: grouped[hour].total,
    count: grouped[hour].count,
  })).sort((a, b) => parseInt(a.hour) - parseInt(b.hour));

  res.json(result);
});

app.get('/api/history/customers', async (req, res) => {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'Date is required' });

  const start = `${date}T00:00:00`;
  const end = `${date}T23:59:59`;

  const { data, error } = await supabase
    .from('customers')
    .select('created_at')
    .gte('created_at', start)
    .lte('created_at', end);

  if (error) return res.status(500).json({ error: error.message });

  const grouped = {};
  data.forEach(c => {
    const hour = new Date(c.created_at).getHours();
    if (!grouped[hour]) grouped[hour] = { total: 0, count: 0 };
    grouped[hour].count += 1;
    grouped[hour].total += 1;
  });

  const result = Object.keys(grouped).map(hour => ({
    hour: `${String(hour).padStart(2, '0')}:00`,
    total: grouped[hour].total,
    count: grouped[hour].count,
  })).sort((a, b) => parseInt(a.hour) - parseInt(b.hour));

  res.json(result);
});

// ----- Customer History (grouped by date) -----
app.get('/api/customers/:id/history', async (req, res) => {
  const { id } = req.params;

  // Get sales
  const { data: sales, error: sErr } = await supabase
    .from('sales')
    .select(`
      *,
      products (name, price)
    `)
    .eq('customer_id', id)
    .order('created_at', { ascending: false });

  if (sErr) return res.status(500).json({ error: sErr.message });

  // Get loans
  const { data: loans, error: lErr } = await supabase
    .from('loans')
    .select(`
      *,
      products (name, price)
    `)
    .eq('customer_id', id)
    .order('created_at', { ascending: false });

  if (lErr) return res.status(500).json({ error: lErr.message });

  const all = [
    ...sales.map(s => ({ ...s, type: 'sale' })),
    ...loans.map(l => ({ ...l, type: 'loan' })),
  ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  const grouped = {};
  all.forEach(t => {
    const date = new Date(t.created_at).toISOString().slice(0, 10);
    if (!grouped[date]) grouped[date] = [];
    grouped[date].push({
      id: t.id,
      product_name: t.products?.name || 'Unknown',
      type: t.type,
      amount: t.amount,
      quantity: t.quantity || 1,
      due_date: t.due_date,
      notes: t.notes,
    });
  });

  res.json(grouped);
});

// ----- Test endpoint -----
app.get('/api/test', async (req, res) => {
  try {
    const { data, error } = await supabase.from('products').select('*').limit(1);
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.json({
    message: 'RAHUSA API is running! 🚀',
    endpoints: {
      products: '/api/products',
      customers: '/api/customers',
      sales: '/api/sales',
      loans: '/api/loans',
      dashboard: '/api/dashboard/stats'
    }
  });
});
// ========== START SERVER ==========
app.listen(port, async () => {
  console.log(`🍪 RAHUSA Backend is running on http://localhost:${port}`);
  await seedProducts();
});
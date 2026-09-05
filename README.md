# ⚡ Razorpay Payment Failure Recovery Agent

> **Razorpay AI Buildathon** — Track: *AI Revenue Recovery*

An autonomous AI-driven agent that automatically detects failed payments from Razorpay webhooks, diagnoses the root failure cause, executes tailored recovery actions (smart retries, payment links with simulated customer SMS notifications), tracks audit logs, and monitors recovered revenue metrics in real-time.

---

## 🚀 Deployment Guide (Host Online)

### ⚠️ Note on Database Persistence (SQLite)
This project uses **SQLite** (`recovery_agent.sqlite`) for fast, file-backed storage with zero database setup required.
> **Note for free hosting tiers (Render / Railway)**: Free instances use ephemeral filesystems, meaning the SQLite database file resets when the instance restarts or redeploys. For hackathon demos and testing, this is completely fine. You can click **"Run 50-Payment Simulator"** on the dashboard at any time to instantly populate realistic demo data.

---

### Option A: Deploy on Render (Recommended - 1-Click)

1. Push your repository to GitHub (ensure `.env` is **not** committed).
2. Go to [Render Dashboard](https://dashboard.render.com/) and click **New +** -> **Blueprint**.
3. Connect your GitHub repository. Render will automatically detect `render.yaml`.
4. Configure the environment variables in Render:
   - `RAZORPAY_KEY_ID`: *(Your Razorpay Test Key ID, optional)*
   - `RAZORPAY_KEY_SECRET`: *(Your Razorpay Test Key Secret, optional)*
   - `BASE_URL`: `https://<your-render-app-name>.onrender.com`
5. Click **Apply**. Your app will build and deploy online automatically!

---

### Option B: Deploy on Railway / Heroku

1. Connect your GitHub repository to [Railway](https://railway.app/).
2. Railway will automatically detect the `Procfile` (`web: npm start`) and Node environment.
3. Add Environment Variables:
   - `PORT`: (Assigned dynamically by Railway)
   - `RAZORPAY_KEY_ID`: *(Optional)*
   - `RAZORPAY_KEY_SECRET`: *(Optional)*
4. Deploy!

---

## 📥 Configuring Razorpay Webhook Endpoint

Once deployed online, configure your Razorpay Webhook in the **Razorpay Dashboard** under **Settings -> Webhooks**:

- **Webhook URL**: `https://<your-deployed-domain>/api/webhooks/razorpay`
- **Active Events**:
  - `payment.failed` *(Triggers AI Failure Classifier & Recovery Engine)*
  - `payment.captured` *(Marks payment as recovered)*
  - `payment_link.paid` *(Marks payment as recovered)*

*(Note: No webhook secret or HMAC signature verification is required; the endpoint accepts incoming payloads directly).*

---

## 💻 Local Development Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Fill in your Razorpay test credentials (if available):
```env
PORT=3000
RAZORPAY_KEY_ID=rzp_test_xxxxxx
RAZORPAY_KEY_SECRET=yyyyyy
DEMO_RETRY_INTERVAL_MINUTES=2
MAX_RETRIES=3
```

### 3. Run Production Server
```bash
npm start
```
Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### 4. Run Test Data Simulator
Populate the database with 50 realistic failed payments:
```bash
npm run simulate
```

---

## 🛠️ Tech Stack & Architecture

- **Backend**: Node.js + Express
- **Database**: SQLite (`sql.js` pure JS WebAssembly database with file persistence)
- **Payment SDK**: Razorpay Node.js SDK (with automatic fallback to Mock Mode if keys omitted)
- **Frontend**: Live Dashboard with Tailwind CSS, Lucide icons, and real-time polling
- **Recovery Engine**: Rule-based AI failure classifier, smart retries, payment links, and stopping rules (max 3 retries)

---

## 📊 Environment Variables Reference

| Variable | Description | Required? | Default |
|---|---|---|---|
| `PORT` | Dynamic web server port | Auto (Hosting) | `3000` |
| `RAZORPAY_KEY_ID` | Razorpay Test Mode Key ID | Optional (Uses Mock if empty) | - |
| `RAZORPAY_KEY_SECRET` | Razorpay Test Mode Key Secret | Optional (Uses Mock if empty) | - |
| `BASE_URL` | Public domain URL for payment link callbacks | Optional | `http://localhost:3000` |
| `DEMO_RETRY_INTERVAL_MINUTES` | Smart retry delay interval for demo | No | `2` |
| `MAX_RETRIES` | Maximum retry attempts per payment | No | `3` |

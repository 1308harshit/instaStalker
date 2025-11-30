# Ngrok Setup Guide

## Step 1: Install Ngrok

### Option A: Download from website (Recommended)
1. Go to: https://ngrok.com/download
2. Download for Windows
3. Extract the `ngrok.exe` file
4. Add to PATH or place in a folder you can access

### Option B: Using Chocolatey (if installed)
```powershell
choco install ngrok
```

### Option C: Using Scoop (if installed)
```powershell
scoop install ngrok
```

### Option D: Manual Download
1. Download: https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-windows-amd64.zip
2. Extract `ngrok.exe`
3. Place in a folder (e.g., `C:\ngrok\`)
4. Add to PATH or use full path

## Step 2: Sign up for free ngrok account
1. Go to: https://dashboard.ngrok.com/signup
2. Sign up (free account works)
3. Get your authtoken from dashboard
4. Run: `ngrok config add-authtoken YOUR_TOKEN`

## Step 3: Start Backend
Backend should already be running on port 3000

## Step 4: Create Tunnel
```powershell
ngrok http 3000
```

You'll see output like:
```
Forwarding  https://abc123.ngrok.io -> http://localhost:3000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

## Step 5: Update Frontend
We'll update the frontend to use the ngrok URL.


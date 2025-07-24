# ProjxonApp 📱

Mobile application for Projxon featuring LinkedIn integration, contact forms, ROI calculator, and blog content.

## 🏗️ Project Structure

```
ProjxonApp/
├── backend/              # Node.js + Express API
│   ├── server.js         # Main Express server
│   ├── package.json      # Backend dependencies
│   └── ...
├── frontend/             # React Native + Expo Mobile App
│   ├── App.js            # Main React Native component
│   ├── app.json          # Expo configuration
│   ├── package.json      # Frontend dependencies
│   └── ...
├── .gitignore            # Git ignore rules
└── README.md             # This file
```

## 🚀 Features

- **LinkedIn Integration** - Display posts from company LinkedIn account
- **Contact Form** - Lead capture and inquiry form
- **ROI Calculator** - Interactive calculator for client value proposition
- **Blog Integration** - Pull blog posts from WordPress Lightsail backend
- **Cross-Platform** - iOS and Android support via React Native + Expo

## 🛠️ Tech Stack

### Backend
- **Node.js** with **Express** framework
- **TypeScript** for type safety and better developer experience
- **CORS** enabled for mobile app requests
- **Helmet** for security headers
- **Morgan** for request logging
- **ts-node** for TypeScript development
- **Nodemon** for development auto-restart

### Frontend
- **React Native** with **Expo SDK 50**
- **TypeScript** for type safety and better developer experience
- **Metro** bundler for fast development
- **Expo Go** app for easy mobile testing
- Cross-platform support (iOS/Android/Web)

## 📋 Prerequisites

- **Node.js** (version 18 or higher)
- **npm** or **yarn**
- **Expo Go** app on your mobile device (for testing)
- **Git** for version control

## 🚀 Getting Started

### 1. Clone and Setup
```bash
git clone https://github.com/PROJXON/ProjxonApp.git
cd ProjxonApp
```

### 2. Backend Setup
```bash
cd backend
npm install
npm run dev    # Starts server with auto-restart on changes
```
Backend will run on `http://localhost:3000`

### 3. Frontend Setup
```bash
cd frontend
npm install
npm start      # Starts Expo development server
```

### 4. Mobile Testing with Expo Go
1. **Install Expo Go** on your phone:
   - iOS: [App Store](https://apps.apple.com/app/expo-go/id982107779)
   - Android: [Google Play](https://play.google.com/store/apps/details?id=host.exp.exponent)

2. **Connect to same WiFi** as your development computer

3. **Scan QR code** from terminal:
   - **iPhone**: Use Camera app
   - **Android**: Use Expo Go app

4. **App loads instantly** on your phone! 📱

## 💻 Development Workflow

### Backend Development
```bash
cd backend
npm run dev         # TypeScript development with ts-node
npm run dev:watch   # TypeScript development with auto-restart
npm run build       # Compile TypeScript to JavaScript
npm start           # Production mode (requires build first)
```

### Frontend Development
```bash
cd frontend
npm start      # Starts Expo with hot reload
# Press 'w' for web version
# Press 'a' for Android emulator
# Press 'i' for iOS simulator
```

### Making Changes
- **Backend**: Save any `.ts` file → server automatically restarts with TypeScript compilation
- **Frontend**: Save any `.tsx` component → app updates instantly on phone with TypeScript
- **Both** support hot reload and TypeScript type checking for fast, safe development!

## 🔄 Git Workflow

1. **Create feature branch**: `git checkout -b your-name/feature-name`
2. **Make changes** and commit
3. **Push branch**: `git push origin your-name/feature-name`
4. **Create Pull Request** on GitHub
5. **Get approval** and merge to main

> 🛡️ **Note**: Direct pushes to `main` are blocked. All changes require PR approval.

## 🌐 API Endpoints (Planned)

```
GET  /api/health              # Health check
GET  /api/linkedin/posts      # Company LinkedIn posts
POST /api/contact             # Contact form submission
POST /api/roi/calculate       # ROI calculator
GET  /api/blog/posts          # WordPress blog posts
```

## 📱 Testing Options

1. **Expo Go** (Recommended) - Real device testing
2. **Web Browser** - Quick UI testing (`npm start` → press 'w')
3. **Android Emulator** - Requires Android Studio
4. **iOS Simulator** - Requires macOS + Xcode

## 🤝 Team Development

### First Time Setup
1. Clone the repo
2. Install dependencies in both `backend/` and `frontend/`
3. Install Expo Go on your phone
4. Run both servers and test!

### Daily Development
1. `git pull origin main` to get latest changes
2. Create your feature branch
3. Run `npm run dev:watch` in backend/ (TypeScript + auto-restart)
4. Run `npm start` in frontend/ (TypeScript + Expo)
5. Develop with live reload and type safety on your phone!

## 🔧 Troubleshooting

**Can't connect to Expo?**
- Ensure phone and computer on same WiFi
- Check firewall isn't blocking connections
- Try restarting Expo server

**Backend not starting?**
- Check Node.js version (need 18+)
- Run `npm install` in backend/
- Check if port 3000 is available

**Need help?** Ask in the team chat or create an issue!

---

**Happy coding!** 🚀

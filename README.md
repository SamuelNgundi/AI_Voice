# Getting Started with Create React App

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

## Local setup

In the project directory, you can run:

### Configuration

Copy `.env.example` to `.env` and fill in your Houndify credentials. The server provides
the public client ID to the app through `/houndifyConfig`; the client key stays
server-side. No `REACT_APP_` environment variable or frontend rebuild is needed when
changing the client ID.

### Backend API

| Route | Method | Purpose |
|---|---|---|
| `/healthz` | GET | Liveness probe |
| `/houndifyConfig` | GET | Returns `{ clientId }` (public ID only) |
| `/houndifyAuth?token=…` | GET | HMAC-signs a token for the browser VoiceRequest |
| `/houndifyText` | POST | Body `{ query, conversationState?, userId?, latitude?, longitude? }`. Signs and forwards to `https://api.houndify.com/v1/text` server-side. Returns the raw Houndify JSON response. The client key never leaves this server. |

### Run the development app

Start the Houndify authentication server in one terminal:

```powershell
npm run start:server
```

Then start the React development server in another:

```powershell
npm start
```

The development server proxies `/houndifyAuth` to Express on port 4000.

### Serve the production build on your local network

```powershell
npm run build
$env:HOST = "0.0.0.0"
$env:PORT = "4000"
npm run start:server
```

On a phone connected to the same Wi-Fi network, open `http://<computer-LAN-IP>:4000`.
Windows Firewall may need to allow Node.js on private networks.

### Testing from your phone (dev mode)

The CRA dev server binds to `localhost` by default, so `http://<LAN-IP>:3000`
will refuse connections. Use one of these scripts instead:

```powershell
npm run start:lan            # HOST=0.0.0.0 (HTTP — page loads, but mic is blocked on mobile)
npm run start:lan:https      # HOST=0.0.0.0 HTTPS=true (recommended for mic testing)
npm run start:server:lan     # backend bound to 0.0.0.0 (only needed for production static hosting)
```

Mobile browsers (Chrome on Android, Safari on iOS, Firefox) require a
**secure origin** for microphone access. `http://<LAN-IP>:3000` is not secure;
you must either use `https://` or tunnel. With `npm run start:lan:https`, CRA
generates a self-signed cert — accept the warning on your phone. On iOS you
also need to trust the cert under Settings → General → About → Certificate
Trust Settings, otherwise `getUserMedia` will still fail.

**Easiest alternative for iOS:** use a tunnel like `npx cloudflared tunnel --url http://localhost:3000`
or [ngrok](https://ngrok.com) — you get a real HTTPS URL with a valid cert and
the mic works immediately.

### Houndify credentials

Keep `HOUNDIFY_CLIENT_KEY` only in the server environment. If a client key was ever
included in browser code or published, rotate it in Houndify. Do not commit `.env`.

## Available Scripts

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

The page will reload if you make edits.\
You will also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can’t go back!**

If you aren’t satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you’re on your own.

You don’t have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn’t feel obligated to use this feature. However we understand that this tool wouldn’t be useful if you couldn’t customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

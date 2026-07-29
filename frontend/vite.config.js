var _a;
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// Dev server proxies /api to the Django backend so the PWA and API share an
// origin during development (PRD §33).
export default defineConfig({
    plugins: [react()],
    server: {
        host: true,
        port: 5173,
        proxy: {
            "/api": {
                target: (_a = process.env.VITE_API_PROXY_TARGET) !== null && _a !== void 0 ? _a : "http://127.0.0.1:8000",
                changeOrigin: true,
            },
        },
    },
});

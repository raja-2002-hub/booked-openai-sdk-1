import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
    plugins: [react()],
    build: {
        outDir: path.resolve(__dirname, "dist"),
        assetsDir: "assets",
        sourcemap: true,
        rollupOptions: {
            // IMPORTANT: produce a named entry 'my-widget' so output HTML is my-widget.html
            input: {
                "my-widget": path.resolve(__dirname, "src/my-widget/index.html"),
            },
        },
    },
    esbuild: {
        jsx: "automatic",
        target: "es2022",
    },

    // dev server: listen on all interfaces, port 4444, enable CORS for local tooling
    server: {
        host: true,
        port: 4444,
        open: false,
        cors: {
            origin: "*",
            methods: ["GET", "HEAD", "POST", "OPTIONS"],
            allowedHeaders: ["*"],
            credentials: false,
        },
        // allowedHosts: ['.ngrok-free.dev'] // optional for ngrok
    },
});

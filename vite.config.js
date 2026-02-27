import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/",

  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "mask-icon.svg"],
      manifest: {
        name: "Whisp Messenger",
        short_name: "Whisp",
        description: "Real-time Whispers",
        theme_color: "#3b82f6", // آبی برند خودت
        background_color: "#111111", // رنگ پس‌زمینه دارک مد
        display: "standalone",
        icons: [
          {
            src: "images.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "images.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
    }),
  ],
})
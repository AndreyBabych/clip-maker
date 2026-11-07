import { defineConfig } from "vite";
export default defineConfig({
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { react: ["react", "react-dom", "react-dom/client"] },
      },
    },
  },
});

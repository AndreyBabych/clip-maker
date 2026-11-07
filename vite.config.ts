import { defineConfig } from "vite";
export default defineConfig({
  // .env.local belongs to the Node server, including NODE_ENV=development.
  // Let Vite choose matching React and JSX runtimes for build/dev itself.
  envDir: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks: { react: ["react", "react-dom", "react-dom/client"] },
      },
    },
  },
});

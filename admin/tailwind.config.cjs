/**
 * Tailwind build for the admin panel (npm run build:admin-css → admin/tailwind.css, committed).
 * The panel used the Tailwind v3 CDN before; this builds the same classes locally so it works offline.
 */
module.exports = {
  content: {
    relative: true,
    files: ["./index.html", "./js/**/*.js"],
  },
  theme: { extend: {} },
  plugins: [],
};

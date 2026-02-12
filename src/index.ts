import {makeApp} from './app';
/* ---------------- startup ---------------- */
const PORT = Number(process.env.PORT ?? 3001);
const app = makeApp();

app.listen(PORT, () => {
  console.log(`API running at http://localhost:${PORT}`);
});

import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "express",
  "express-rate-limit",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    // Phase 12 Axe B J2 — passage CJS → ESM. Le bundle CJS rendait
    // `import.meta.dirname` égal à `undefined` au runtime (esbuild
    // émettait 3 warnings devenus crash en NODE_ENV=production sur
    // server/services/stationsService.ts (PATIENT_DIR, EVALUATOR_DIR)
    // et server/lib/prompts.ts (PROMPTS_DIR)). Conserver `import.meta`
    // natif côté ESM élimine la classe entière.
    format: "esm",
    outfile: "dist/index.js",
    target: "node20",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    // Banner d'interop : certaines deps CJS bundlées (express 5,
    // path-to-regexp, multer, pg, …) appellent `require()` dynamiquement
    // au runtime. En mode ESM, `require` n'existe pas : on le restitue
    // via `createRequire(import.meta.url)`. Coût zéro si non utilisé.
    banner: {
      js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
    },
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});

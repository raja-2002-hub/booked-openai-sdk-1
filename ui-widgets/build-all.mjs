// ui-widgets/build-all.mjs
import { build } from "vite";
import react from "@vitejs/plugin-react";
import fg from "fast-glob";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import tailwindcss from "@tailwindcss/vite";

async function main() {
    // 1) Discover all widget entry files
    const entries = fg.sync("src/*/index.{tsx,jsx,js}", { dot: false, onlyFiles: true })
        .sort(); // stable order
    if (!entries.length) {
        console.error("No entry files found under src/*/index.{tsx,jsx,js}");
        process.exit(1);
    }

    // 2) Output directory (served by MCP)
    const outDir = "dist/assets";

    // 3) Per-entry CSS discovery
    const PER_ENTRY_CSS_GLOB = "**/*.{css,pcss,scss,sass}";
    const PER_ENTRY_CSS_IGNORE = ["**/*.module.*"];
    const GLOBAL_CSS_LIST = [path.resolve("src/index.css")]; // optional global tailwind/app css

    // 4) Stable short hash (from package.json version)
    const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8"));
    const h = crypto.createHash("sha256").update(String(pkg.version || ""), "utf8").digest("hex").slice(0, 6);

    // 5) Clean output
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    const builtNames = [];

    function wrapEntryPlugin(virtualId, entryFile, cssPaths) {
        return {
            name: `virtual-entry-wrapper:${entryFile}`,
            resolveId(id) {
                if (id === virtualId) return id;
            },
            load(id) {
                if (id !== virtualId) return null;
                const cssImports = (cssPaths || []).map((css) => `import ${JSON.stringify(css)};`).join("\n");
                return `
${cssImports}
export * from ${JSON.stringify(entryFile)};
import * as __entry from ${JSON.stringify(entryFile)};
export default (__entry.default ?? __entry.App);
import ${JSON.stringify(entryFile)};
`;
            },
        };
    }

    // Helper: rename a file + its .map (if exists) and update map "file" field
    function renameWithMap(oldPath, newBaseName) {
        if (!fs.existsSync(oldPath)) return null;
        const dir = path.dirname(oldPath);
        const ext = path.extname(oldPath); // .js or .css
        const newPath = path.join(dir, `${newBaseName}${ext}`);
        fs.renameSync(oldPath, newPath);

        const oldMap = `${oldPath}.map`;
        if (fs.existsSync(oldMap)) {
            const mapJson = JSON.parse(fs.readFileSync(oldMap, "utf8"));
            mapJson.file = `${newBaseName}${ext}`; // keep map metadata aligned
            const newMap = `${newPath}.map`;
            fs.writeFileSync(newMap, JSON.stringify(mapJson));
            fs.rmSync(oldMap);
            return { file: newPath, map: newMap };
        }
        return { file: newPath, map: null };
    }

    // 6) Build every widget folder
    for (const file of entries) {
        const name = path.basename(path.dirname(file)); // folder name => widget name
        const entryAbs = path.resolve(file);
        const entryDir = path.dirname(entryAbs);

        const perEntryCss = fg.sync(PER_ENTRY_CSS_GLOB, {
            cwd: entryDir, absolute: true, dot: false, ignore: PER_ENTRY_CSS_IGNORE,
        });

        const globalCss = GLOBAL_CSS_LIST.filter((p) => fs.existsSync(p));
        const cssToInclude = [...globalCss, ...perEntryCss].filter((p) => fs.existsSync(p));

        const virtualId = `\0virtual-entry:${entryAbs}`;

        const viteConfig = {
            plugins: [
                wrapEntryPlugin(virtualId, entryAbs, cssToInclude),
                tailwindcss(),
                react(),
                {
                    name: "remove-manual-chunks",
                    outputOptions(options) {
                        if ("manualChunks" in options) delete options.manualChunks;
                        return options;
                    },
                },
            ],
            esbuild: {
                jsx: "automatic",
                jsxImportSource: "react",
                target: "es2022",
            },
            build: {
                target: "es2022",
                outDir,
                emptyOutDir: false,            // we already cleaned once
                chunkSizeWarningLimit: 2000,
                minify: "esbuild",
                cssCodeSplit: false,           // single css per entry
                sourcemap: true,               // emit .map files
                rollupOptions: {
                    input: virtualId,
                    output: {
                        format: "es",
                        entryFileNames: `${name}.js`,
                        inlineDynamicImports: true,
                        assetFileNames: (info) =>
                            (info.name || "").endsWith(".css") ? `${name}.css` : `[name]-[hash][extname]`,
                    },
                    preserveEntrySignatures: "allow-extension",
                    treeshake: true,
                },
            },
        };

        console.group(`Building ${name}`);
        await build(viteConfig);
        console.groupEnd();
        builtNames.push(name);
        console.log(`Built ${name}`);
    }

    // 7) Append short hash to .js / .css (and their .map)
    const outputs = fs.readdirSync(outDir).filter((f) => f.endsWith(".js") || f.endsWith(".css"));
    for (const out of outputs) {
        const full = path.join(outDir, out);
        const baseNoExt = path.basename(full, path.extname(full));
        const newBase = `${baseNoExt}-${h}`; // keep original base name + -hash
        const renamed = renameWithMap(full, newBase);
        console.log(`${outDir}/${out} -> ${renamed?.file}`);
    }

    console.log("hash:", h);

    // 8) Generate self-contained HTML per widget with inlined CSS+JS
    for (const name of builtNames) {
        const jsPath = path.join(outDir, `${name}-${h}.js`);
        const cssPath = path.join(outDir, `${name}-${h}.css`);
        const js = fs.existsSync(jsPath) ? fs.readFileSync(jsPath, "utf8") : "";
        const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, "utf8") : "";

        const cssBlock = css ? `\n  <style>\n${css}\n  </style>\n` : "";
        const jsBlock = js ? `\n  <script type="module">\n${js}\n  </script>` : "";

        const html = [
            "<!doctype html>",
            "<html>",
            `<head>${cssBlock}</head>`,
            "<body>",
            `  <div id="${name}-root"></div>${jsBlock}`,
            "</body>",
            "</html>",
        ].join("\n");

        const htmlPath = path.join(outDir, `${name}-${h}.html`);
        fs.writeFileSync(htmlPath, html, "utf8");
        console.log(`Generated ${htmlPath}`);
    }

    console.log("Build complete. Artifacts written to", path.resolve(outDir));
}

main().catch((err) => {
    console.error("Build failed:", err);
    process.exit(1);
});

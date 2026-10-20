import express, { type Express } from "express";
import fs from "fs";
import { type Server } from "http";
import { nanoid } from "nanoid";
import path from "path";
import { createServer as createViteServer } from "vite";
import viteConfig from "../../vite.config";

export async function setupVite(app: Express, server: Server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true as const,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}


export function serveStatic(app: Express) {
  const distPath = path.resolve(
    import.meta.dirname,
    "public",
  );

  if (!fs.existsSync(path.join(distPath, "index.html"))) {
    throw new Error(
      `Production frontend not found at ${distPath}. Run pnpm build first.`,
    );
  }

  app.use(
    express.static(distPath, {
      index: false,

      setHeaders(res, filePath) {
        const isHashedAsset =
          filePath.includes(`${path.sep}assets${path.sep}`) &&
          /-[A-Za-z0-9_-]{8,}\.(?:js|css|svg|woff2?|png|jpe?g|webp)$/i.test(
            filePath,
          );

        if (isHashedAsset) {
          res.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable",
          );
        } else {
          res.setHeader(
            "Cache-Control",
            "public, max-age=300",
          );
        }
      },
    }),
  );

  // Return index.html for client-side routes such as /tours
  // and /destinations. Do not cache the HTML across releases.
  app.use("*", (_req, res, next) => {
    res.setHeader(
      "Cache-Control",
      "no-cache, no-store, must-revalidate",
    );

    res.sendFile(
      path.join(distPath, "index.html"),
      (error) => {
        if (error) next(error);
      },
    );
  });
}


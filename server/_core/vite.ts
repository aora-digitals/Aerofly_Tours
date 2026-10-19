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
  const distPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(
          import.meta.dirname,
          "../..",
          "dist",
          "public",
        )
      : path.resolve(import.meta.dirname, "public");

  if (!fs.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}. Build the client first.`,
    );
  }

  app.use(
    express.static(distPath, {
      index: false,
      setHeaders(res, filePath) {
        const isFingerprintAsset =
          /[.-][A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|jpe?g|webp|avif|svg)$/i.test(
            path.basename(filePath),
          );

        if (isFingerprintAsset) {
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

        res.setHeader("X-Content-Type-Options", "nosniff");
      },
    }),
  );

  app.use("*", (req, res, next) => {
    // API paths must not silently become the SPA HTML page.
    if (
      req.path === "/api" ||
      req.path.startsWith("/api/") ||
      req.path.startsWith("/functions/")
    ) {
      next();
      return;
    }

    res.setHeader(
      "Cache-Control",
      "no-cache, no-store, must-revalidate",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    res.sendFile(
      path.resolve(distPath, "index.html"),
      (error) => {
        if (error && !res.headersSent) next(error);
      },
    );
  });
}


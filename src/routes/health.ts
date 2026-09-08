import { Router } from 'express';

export function createHealthRouter(checkStorage: () => void): Router {
  const router = Router();
  router.get('/healthz', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      checkStorage();
      res.status(200).json({ status: 'ok', checks: { sqlite: 'ok' } });
    } catch (error) {
      next(error);
    }
  });
  return router;
}

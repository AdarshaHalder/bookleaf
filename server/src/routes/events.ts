import { Router } from "express";
import { authenticate, currentUser } from "../middleware/auth";
import { subscribe } from "../realtime/hub";

const router = Router();

/** GET /api/events?token=<jwt> — SSE stream of ticket change notifications for this user. */
router.get("/", authenticate({ allowQueryToken: true }), (req, res) => {
  const unsubscribe = subscribe(currentUser(req), res);
  req.on("close", unsubscribe);
});

export default router;

// api/signup.js

import { createUser } from "../lib/auth.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "REQUEST_FAILED"
    });
  }

  try {
    const {
      name,
      username,
      password
    } = req.body || {};

    const cleanName =
      String(name || "").trim();

    const cleanUsername =
      String(username || "")
        .trim()
        .toLowerCase();

    const cleanPassword =
      String(password || "");

    // Basic validation
    if (
      !cleanName ||
      !cleanUsername ||
      !cleanPassword
    ) {
      return res.status(400).json({
        error: "REQUEST_FAILED"
      });
    }

    // Username validation
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(cleanUsername)) {
      return res.status(400).json({
        error: "REQUEST_FAILED"
      });
    }

    // Password validation
    if (cleanPassword.length < 6) {
      return res.status(400).json({
        error: "REQUEST_FAILED"
      });
    }

    const user = await createUser({
      name: cleanName,
      username: cleanUsername,
      password: cleanPassword
    });

    return res.status(201).json({
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        plan: user.plan || "free"
      }
    });

  } catch (error) {
    console.error(
      "SIGNUP ERROR:",
      error
    );

    /*
      Do not expose database or server
      technical details to the user.
    */

    if (
      error?.code === "USERNAME_EXISTS"
    ) {
      return res.status(409).json({
        error: "USERNAME_EXISTS"
      });
    }

    return res.status(500).json({
      error: "REQUEST_FAILED"
    });
  }
}

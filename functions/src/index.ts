import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import * as nodemailer from "nodemailer";

admin.initializeApp();
const db = admin.firestore();

// Helper to check if caller is admin
async function assertAdmin(contextAuth: any) {
  if (!contextAuth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  const callerId = contextAuth.uid;
  const callerDoc = await db.collection("users").doc(callerId).get();
  const callerData = callerDoc.data();
  if (!callerData || callerData.role !== "ADMIN") {
    throw new HttpsError("permission-denied", "Only administrators can perform this action.");
  }
}

/**
 * Cloud Function: Admin creates a user in Firebase Auth and Firestore
 */
export const adminCreateUser = onCall(async (request) => {
  await assertAdmin(request.auth);

  const { email, password, name, role, organisation, calling, gender, username } = request.data;

  if (!email || !password || !name || !role) {
    throw new HttpsError("invalid-argument", "Missing required fields: email, password, name, role.");
  }

  try {
    // 1. Create in Firebase Auth
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name,
    });

    const uid = userRecord.uid;
    const now = new Date().toISOString();

    // 2. Create in Firestore 'users' collection
    const userProfile = {
      user_id: uid,
      name,
      username: username || email.split("@")[0].replace(/[^a-z0-9._-]/g, ""),
      email,
      role,
      organisation: organisation || "",
      calling: calling || "",
      gender: gender || "",
      created_date: now,
      must_reset_password: true,
      disabled: false,
    };

    await db.collection("users").doc(uid).set(userProfile);

    return { ok: true, user_id: uid };
  } catch (error: any) {
    console.error("Error creating user:", error);
    throw new HttpsError("internal", error.message || "Failed to create user.");
  }
});

/**
 * Cloud Function: Admin deletes a user in Firebase Auth and Firestore
 */
export const adminDeleteUser = onCall(async (request) => {
  await assertAdmin(request.auth);

  const { user_id } = request.data;
  if (!user_id) {
    throw new HttpsError("invalid-argument", "Missing user_id parameter.");
  }

  try {
    // Look up user profile to resolve Auth UID
    const userDoc = await db.collection("users").doc(user_id).get();
    let authUid = user_id;
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData && userData.auth_uid) {
        authUid = userData.auth_uid;
      }
    }

    // 1. Delete from Firebase Auth
    try {
      await admin.auth().deleteUser(authUid);
    } catch (authErr: any) {
      if (authErr.code !== "auth/user-not-found") {
        throw authErr;
      }
    }

    // 2. Delete from Firestore 'users' collection
    await db.collection("users").doc(user_id).delete();

    return { ok: true };
  } catch (error: any) {
    console.error("Error deleting user:", error);
    throw new HttpsError("internal", error.message || "Failed to delete user.");
  }
});

/**
 * Cloud Function: Admin enables/disables a user account
 */
export const adminToggleUserStatus = onCall(async (request) => {
  await assertAdmin(request.auth);

  const { user_id, disabled } = request.data;
  if (!user_id || typeof disabled !== "boolean") {
    throw new HttpsError("invalid-argument", "Missing or invalid parameters.");
  }

  try {
    // Look up user profile to resolve Auth UID
    const userDoc = await db.collection("users").doc(user_id).get();
    let authUid = user_id;
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData && userData.auth_uid) {
        authUid = userData.auth_uid;
      }
    }

    // 1. Update status in Firebase Auth
    try {
      await admin.auth().updateUser(authUid, { disabled });
    } catch (authErr: any) {
      if (authErr.code !== "auth/user-not-found") {
        throw authErr;
      }
    }

    // 2. Update status in Firestore
    await db.collection("users").doc(user_id).update({ disabled });

    return { ok: true };
  } catch (error: any) {
    console.error("Error toggling user status:", error);
    throw new HttpsError("internal", error.message || "Failed to update user status.");
  }
});

/**
 * Cloud Function: Admin resets a user's password and sets must_reset_password
 */
export const adminResetPassword = onCall(async (request) => {
  await assertAdmin(request.auth);

  const { user_id, password } = request.data;
  if (!user_id || !password) {
    throw new HttpsError("invalid-argument", "Missing user_id or password parameters.");
  }

  try {
    // Look up user profile to resolve Auth UID
    const userDoc = await db.collection("users").doc(user_id).get();
    let authUid = user_id;
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData && userData.auth_uid) {
        authUid = userData.auth_uid;
      }
    }

    // 1. Update password in Firebase Auth using the correct Auth UID
    await admin.auth().updateUser(authUid, { password });

    // 2. Update Firestore profile to require reset
    await db.collection("users").doc(user_id).update({ must_reset_password: true });

    return { ok: true };
  } catch (error: any) {
    console.error("Error resetting user password:", error);
    throw new HttpsError("internal", error.message || "Failed to reset password.");
  }
});

/**
 * Cloud Function: Migrates a legacy user to Firebase Auth with their existing UID
 */
export const migrateLegacyUser = onCall(async (request) => {
  const { email, password, uid } = request.data;
  if (!email || !password || !uid) {
    throw new HttpsError("invalid-argument", "Missing email, password, or uid.");
  }

  try {
    // Check if user exists in Firestore
    const userDoc = await db.collection("users").doc(uid).get();
    if (!userDoc.exists) {
      throw new HttpsError("not-found", "Legacy user profile not found in Firestore.");
    }

    // Create the Firebase Auth user with the exact existing UID
    await admin.auth().createUser({
      uid,
      email,
      password,
    });

    console.log(`Successfully migrated user ${email} with legacy UID ${uid}`);
    return { ok: true };
  } catch (error: any) {
    console.error("Error migrating legacy user:", error);
    throw new HttpsError("internal", error.message || "Failed to migrate user.");
  }
});

// Configure Nodemailer transporter (read from environment or fall back to log for dev)
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || "",
  port: Number(process.env.SMTP_PORT) || 587,
  auth: {
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  },
});

/**
 * Cloud Function: Triggered when a new document is written to 'notifications' collection
 */
export const sendNotificationEmail = onDocumentCreated("notifications/{notificationId}", async (event) => {
  const notif = event.data?.data();
  if (!notif || !notif.to_user_id || !notif.title || notif.read) return;

  try {
    // 1. Find user profile in Firestore
    const userDoc = await db.collection("users").doc(notif.to_user_id).get();
    const user = userDoc.data();
    if (!user || !user.email) {
      console.log(`User ${notif.to_user_id} not found or has no email.`);
      return;
    }

    // 2. Build email body
    const mailOptions = {
      from: '"Sacrament Meeting Planner" <noreply@your-domain.com>',
      to: user.email,
      subject: notif.title,
      text: `${notif.body}\n\n---\nSacrament Meeting Planner\nThis is an automated notification. Please log in to the platform to take action.`,
    };

    if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      await mailTransporter.sendMail(mailOptions);
      console.log(`Notification email sent to ${user.email}`);
    } else {
      console.log(`[SMTP Offline] Email would be sent to: ${user.email}`);
      console.log(`Subject: ${notif.title}`);
      console.log(`Body: ${notif.body}`);
    }
  } catch (error) {
    console.error("Failed to send notification email:", error);
  }
});

/**
 * Cloud Function: Scheduled function to run checklist reminders periodically
 */
export const runChecklistReminders = onSchedule("0 8 * * 5", async () => {
  console.log("Running checklist reminders scheduled job...");

  const now = new Date().toISOString();
  
  // 1. Fetch submitted planners
  const plannersSnap = await db.collection("planners").where("state", "==", "SUBMITTED").get();
  if (plannersSnap.empty) {
    console.log("No active (submitted) planners found.");
    return;
  }

  // 2. Fetch all users
  const usersSnap = await db.collection("users").where("disabled", "==", false).get();
  const users = usersSnap.docs.map(doc => doc.data());
  const usersToNotify = users.filter(u => u.role !== "MUSIC");

  // 3. For each active planner, find incomplete checklist tasks
  for (const plannerDoc of plannersSnap.docs) {
    const planner = plannerDoc.data();
    const plannerId = planner.planner_id;

    const checklistsSnap = await db.collection("checklists")
      .where("planner_id", "==", plannerId)
      .where("status", "==", false)
      .get();

    if (checklistsSnap.empty) continue;

    const incomplete = checklistsSnap.docs.map(doc => doc.data());

    // Group by week
    const weeksWithIncomplete = [...new Set(incomplete.map(c => c.week_id))];

    // Send notifications to each eligible user
    for (const week_id of weeksWithIncomplete) {
      const weekTasks = incomplete.filter(c => c.week_id === week_id);
      const weekLabel = weekTasks[0]?.week_label || "Active Week";

      for (const user of usersToNotify) {
        const notifId = "notif_" + Math.random().toString(36).substring(2, 11);
        const notification = {
          notification_id: notifId,
          to_user_id: user.user_id,
          type: "REMINDER",
          created_date: now,
          read: false,
          title: "Checklist Reminder",
          body: `There are ${weekTasks.length} items incomplete in the checklist for ${weekLabel}.`,
          meta: JSON.stringify({ planner_id: plannerId, week_id: week_id })
        };

        await db.collection("notifications").doc(notifId).set(notification);
      }
    }
  }
  console.log("Scheduled checklist reminders completed.");
});

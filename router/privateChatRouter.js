const express = require("express");
const router = express.Router();
const privateChatController = require("../controllers/privateChatController");
const { authMiddleware } = require("../middleware/auth");

//  * ✅ GET all conversations for a user
//  * GET /api/private/conversations
router.get(
  "/get-all-conversations",
  authMiddleware,
  privateChatController.getConversations
);

/**
 * ✅ GET single conversation by ID
 * GET /api/private/conversations/:conversationId
 */
router.get(
  "/get-conversations-byId/:conversationId",
  authMiddleware,
  privateChatController.getConversationById
);

// * ✅ GET or CREATE conversation between two users
//  * POST /api/private/conversations/:userId
//  * Creates a new conversation if doesn't exist, or returns existing one
//  */

router.post(
  "/get-or-create-conversations/:userId",
  authMiddleware,
  privateChatController.getOrCreateConversation
);

// * ✅ GET messages for a conversation with pagination

router.get(
  "/conversations/:conversationId/messages",
  authMiddleware,
  privateChatController.getMessagesForConversation
);

//  * ✅ SEND message via REST API
router.post("/send-messages", authMiddleware, privateChatController.sendMessage);

//  * ✅ EDIT message
router.put(
  "/edit-message/:messageId",
  authMiddleware,
  privateChatController.editMessage
);

//  * ✅ DELETE message
router.delete(
  "/delete-message/:messageId",
  authMiddleware,
  privateChatController.deleteMessage
);

//  * ✅ MARK message as read
router.put(
  "/mark-as-read/:messageId",
  authMiddleware,
  privateChatController.markMessageAsRead
);

//  * ✅ MARK all messages in a conversation as read
router.put(
  "/mark-all-as-read/:conversationId",
  authMiddleware,
  privateChatController.markConversationAsRead
);

//  * ✅ DELETE conversation (soft delete - just mark as inactive)?
router.delete(
  "/delete-conversation/:conversationId",
  authMiddleware,
  privateChatController.deleteConversation
);

//  * ✅ GET unread message count
router.get(
  "/unread-message-count",
  authMiddleware,
  privateChatController.getUnreadMessageCount
);

module.exports = router;

// ============================================
// FILE: services/storyPostSessionService.js

const axios = require("axios");
const Logger = require("../utils/logger");
const usersQueries = require("../database/databaseQueries/userQueries");
const whatsappService = require("./whatsappService");
const languageService = require("./languageService");
const fs = require("fs").promises;
const path = require("path");
const { randomUUID } = require("crypto");
const uploadDoneTimers = new Map();
const {
  makeApiRequest,
  downloadBinaryFile,
} = require("../generics/services/axios");

const MOHINI_BASE_URL = process.env.BACKEND_API_URL;

const MAX_PHOTOS = 10;

class StoryPostSessionService {
  constructor() {
    this.tempDir = process.env.TEMP_DIR || path.join(__dirname, "..", "temp");
    this.maxFileSize = 25 * 1024 * 1024; // 25MB
  }

  // ─────────────────────────────────────────────────────────────────
  // 1.  Entry point – called by sessionService AFTER it has confirmed
  //     the session status is COMPLETED via /api/companychat/.
  //
  //     `sessionOverride` is the session object passed directly from
  //     sessionService (avoids a DB round-trip when we already have it).
  // ─────────────────────────────────────────────────────────────────
  async startPostSession(phoneNumber, sessionOverride = null) {
    try {
      Logger.info("Post-session flow starting", { phoneNumber });
      const keys = ["sessionCompleted"];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );
      // Prefer the passed-in session; fall back to whatever is still in DB
      let session = sessionOverride;
      if (!session?.sessionId) {
        const user = await usersQueries.findOne({ phoneNumber });
        session = user?.scope?.activeSession;
      }

      if (!session?.sessionId) {
        Logger.warn("startPostSession: no session data available", {
          phoneNumber,
        });
        await whatsappService.sendMessage(
          phoneNumber,
          `✅ ${selectedLanguageText.sessionCompleted} `,
        );
        return;
      }

      // ── A. Double-check completion via companychat (safety net) ──
      // sessionService normally verifies this before calling us, but
      // we guard here too so direct calls (e.g. session_end message)
      // don't bypass the check accidentally.
      whatsappService.sendTyping(phoneNumber);

      const sessionService = require("./sessionService");
      const isCompleted = await sessionService.checkSessionCompleted(
        session.sessionId,
      );

      if (!isCompleted) {
        Logger.warn(
          "startPostSession: companychat NOT completed – aborting post-session",
          {
            phoneNumber,
            sessionId: session.sessionId,
          },
        );
        // sessionService's WS close handler has already offered reconnect;
        // nothing more to do here.
        return;
      }

      Logger.info("Session confirmed COMPLETED – proceeding", {
        phoneNumber,
        sessionId: session.sessionId,
      });

      // ── B. Call end-story ────────────────────────────────────────
      await this._callEndStory(phoneNumber, session);

      // ── C. Set flow state ────────────────────────────────────────
      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "post_session_upload",
        step: 1,
        context: {
          sessionId: session.sessionId,
          profileId: session.profileId,
          flowName: session.flowName || "guest-discussion",
          language: session.language || "en",
          uploadCount: 0,
          storyId: null,
        },
        text: "post_session_start",
      });

      // ── D. Ask user about photos ─────────────────────────────────
      await this._askForPhotos(phoneNumber);
    } catch (error) {
      Logger.error("startPostSession error", {
        phoneNumber,
        error: error.message,
      });
      const keys = ["sessionCompleted"];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );
      try {
        await whatsappService.sendMessage(
          phoneNumber,
          `✅ ${selectedLanguageText.sessionCompleted} `,
        );
      } catch (_) {}
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 2.  Handle an incoming WhatsApp image during post_session_upload
  // ─────────────────────────────────────────────────────────────────
  // async handlePhotoUpload(phoneNumber, message) {
  //   try {
  //     const lastMsg = await usersQueries.getLastMessage(phoneNumber);
  //     const ctx = lastMsg?.context || {};

  //     const mediaType = message.type; // "image", "document", "video", "audio"
  //     const mediaId = message[mediaType]?.id;
  //     // let mediaUrl = message[mediaType]?.link;

  //     // if (!mediaUrl && mediaId) {
  //     //   mediaUrl = await whatsappService.getMediaUrl(mediaId);
  //     // }
  //     const mimeType =
  //       message[mediaType]?.mime_type || "application/octet-stream";
  //     const keys = [
  //       "maxPhotosWarning",
  //       "doneMessage",
  //       "imageDownloadError",
  //       "storyDownloadError",
  //       "imageUploadSuccess",
  //       "remainingPhotos",
  //       "completedStatusText",
  //       "addMorePhotos",
  //       "reportGenerationMessage",
  //     ];
  //     const selectedLanguageText = await languageService.tBatch(
  //       phoneNumber,
  //       keys,
  //     );
  //     if (ctx.uploadCount >= MAX_PHOTOS) {
  //       await whatsappService.sendMessage(
  //         phoneNumber,
  //         `⚠️ ${selectedLanguageText.maxPhotosWarning}  ` +
  //           `${selectedLanguageText.doneMessage}`,
  //       );
  //       return { success: false, handled: true };
  //     }

  //     Logger.info("Uploading photo", {
  //       phoneNumber,
  //       uploadCount: ctx.uploadCount,
  //       storyId: ctx.storyId,
  //     });

  //     const uniqueId = randomUUID().slice(0, 8);
  //     const fileName = `${Date.now()}_${uniqueId}.${this.getFileExtension(mediaType)}`;
  //     // ── Step 1: Download image from WhatsApp ─────────────────────
  //     const downloadedFile = await this._downloadWhatsAppImage(
  //       mediaId,
  //       fileName,
  //     );
  //     const { buffer, filePath } = downloadedFile;
  //     if (!buffer) {
  //       await whatsappService.sendMessage(
  //         phoneNumber,
  //         `❌ ${selectedLanguageText.imageDownloadError}`,
  //       );
  //       return { success: false, handled: true };
  //     }

  //     // ── Step 2: Fetch storyId if we don't have it yet ────────────
  //     let storyId = ctx.storyId;
  //     if (!storyId) {
  //       storyId = await this._fetchStoryId(phoneNumber, ctx.sessionId);

  //       if (!storyId) {
  //         await whatsappService.sendMessage(
  //           phoneNumber,
  //           `❌ ${selectedLanguageText.storyDownloadError}`,
  //         );
  //         return { success: false, handled: true };
  //       }
  //       await usersQueries.updateLastMessage(phoneNumber, {
  //         context: { ...ctx, storyId },
  //       });
  //     }

  //     // ── Step 3: Get presigned URL ────────────────────────────────
  //     const presigned = await this._getPresignedUrl(phoneNumber, {
  //       fileName,
  //       fileType: mimeType,
  //       storyId,
  //       folder_structure: "chatbot/storymedia/",
  //     });

  //     if (!presigned) {
  //       await whatsappService.sendMessage(
  //         phoneNumber,
  //         `❌ ${selectedLanguageText.imageDownloadError}`,
  //       );
  //       return { success: false, handled: true };
  //     }

  //     // ── Step 4: PUT to S3 ────────────────────────────────────────
  //     const s3Url = await this._uploadToS3(
  //       presigned.uploadUrl,
  //       buffer,
  //       mimeType,
  //       fileName,
  //     );
  //     if (!s3Url) {
  //       await whatsappService.sendMessage(
  //         phoneNumber,
  //         `❌ ${selectedLanguageText.imageDownloadError}`,
  //       );
  //       return { success: false, handled: true };
  //     }

  //     // ── Step 5: Register with storymedia API ─────────────────────
  //     await this._registerStorymedia(phoneNumber, {
  //       file_url: presigned.s3Url,
  //       storyId,
  //       fileName,
  //       mimeType,
  //       sessionId: ctx.sessionId,
  //       flowName: ctx.flowName,
  //     });

  //     // ── Step 6: Update upload count in context ───────────────────
  //     const newCount = await usersQueries.incrementUploadCount(phoneNumber);
  //     await usersQueries.updateLastMessage(phoneNumber, {
  //       flow: "post_session_upload",
  //       step: 2,
  //       context: { ...ctx, storyId, uploadCount: newCount },
  //       text: "photo_uploaded",
  //     });

  //     Logger.info("Photo uploaded successfully", {
  //       phoneNumber,
  //       uploadCount: newCount,
  //       storyId,
  //     });

  //     // ── Delete temp file after successful S3 upload ──────────────
  //     if (filePath) {
  //       fs.unlink(filePath).catch((err) =>
  //         Logger.warn("Failed to delete temp file", {
  //           filePath,
  //           error: err.message,
  //         }),
  //       );
  //     }

  //     // ── Step 7: Acknowledge and ask for more / offer to finish ───
  //     // ── Step 7: Acknowledge upload, debounce the "done" trigger ─────
  //     const remaining = MAX_PHOTOS - newCount;

  //     await whatsappService.sendMessage(
  //       phoneNumber,
  //       `✅ ${newCount}/${MAX_PHOTOS} ${selectedLanguageText.imageUploadSuccess}`,
  //     );

  //     if (remaining <= 0) {
  //       // Hit the limit — trigger immediately, no need to wait
  //       if (uploadDoneTimers.has(phoneNumber)) {
  //         clearTimeout(uploadDoneTimers.get(phoneNumber));
  //         uploadDoneTimers.delete(phoneNumber);
  //       }
  //       await whatsappService.sendMessage(
  //         phoneNumber,
  //         `✅ ${selectedLanguageText.reportGenerationMessage}`,
  //       );
  //       await this.handleUploadDone(phoneNumber);
  //     } else {
  //       // More uploads may be coming — wait 3s before calling done
  //       // scheduleUploadDone(
  //       //   phoneNumber,
  //       //   async () => {
  //       //     await whatsappService.sendMessage(
  //       //       phoneNumber,
  //       //       `✅ ${selectedLanguageText.reportGenerationMessage}`,
  //       //     );
  //       //     await this.handleUploadDone(phoneNumber);
  //       //   },
  //       //   3000,
  //       // );
  //       const self = this;
  //       const langText = selectedLanguageText; // capture before async gap
  //       scheduleUploadDone(
  //         phoneNumber,
  //         async () => {
  //           await whatsappService.sendMessage(
  //             phoneNumber,
  //             `✅ ${langText.reportGenerationMessage}`,
  //           );
  //           await self.handleUploadDone(phoneNumber);
  //         },
  //         3000,
  //       );
  //     }

  //     return { success: true, handled: true };
  //   } catch (error) {
  //     Logger.error("handlePhotoUpload error", {
  //       phoneNumber,
  //       error: error.message,
  //     });

  //     const keys = ["imageDownloadError"];
  //     const selectedLanguageText = await languageService.tBatch(
  //       phoneNumber,
  //       keys,
  //     );
  //     await whatsappService.sendMessage(
  //       phoneNumber,
  //       `❌ ${selectedLanguageText.imageDownloadError}`,
  //     );
  //     return { success: false, handled: true };
  //   }
  // }

  async handlePhotoUpload(phoneNumber, message) {
    try {
      const lastMsg = await usersQueries.getLastMessage(phoneNumber);
      const ctx = lastMsg?.context || {};

      const mediaType = message.type; // "image", "document", "video", "audio"
      const mediaId = message[mediaType]?.id;
      // let mediaUrl = message[mediaType]?.link;

      // if (!mediaUrl && mediaId) {
      //   mediaUrl = await whatsappService.getMediaUrl(mediaId);
      // }
      const mimeType =
        message[mediaType]?.mime_type || "application/octet-stream";
      const keys = [
        "maxPhotosWarning",
        "doneMessage",
        "imageDownloadError",
        "storyDownloadError",
        "imageUploadSuccess",
        "remainingPhotos",
        "completedStatusText",
        "addMorePhotos",
        "reportGenerationMessage",
      ];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );
      if (ctx.uploadCount >= MAX_PHOTOS) {
        await whatsappService.sendMessage(
          phoneNumber,
          `⚠️ ${selectedLanguageText.maxPhotosWarning}  ` +
            `${selectedLanguageText.doneMessage}`,
        );
        return { success: false, handled: true };
      }

      Logger.info("Uploading photo", {
        phoneNumber,
        uploadCount: ctx.uploadCount,
        storyId: ctx.storyId,
      });

      const uniqueId = randomUUID().slice(0, 8);
      const fileName = `${Date.now()}_${uniqueId}.${this.getFileExtension(mediaType)}`;
      // ── Step 1: Download image from WhatsApp ─────────────────────
      const downloadedFile = await this._downloadWhatsAppImage(
        mediaId,
        fileName,
      );
      const { buffer, filePath } = downloadedFile;
      if (!buffer) {
        await whatsappService.sendMessage(
          phoneNumber,
          `❌ ${selectedLanguageText.imageDownloadError}`,
        );
        return { success: false, handled: true };
      }

      // ── Step 2: Fetch storyId if we don't have it yet ────────────
      let storyId = ctx.storyId;
      if (!storyId) {
        storyId = await this._fetchStoryId(phoneNumber, ctx.sessionId);

        if (!storyId) {
          await whatsappService.sendMessage(
            phoneNumber,
            `❌ ${selectedLanguageText.storyDownloadError}`,
          );
          return { success: false, handled: true };
        }
        await usersQueries.updateLastMessage(phoneNumber, {
          context: { ...ctx, storyId },
        });
      }

      // ── Step 3: Get presigned URL ────────────────────────────────
      const presigned = await this._getPresignedUrl(phoneNumber, {
        fileName,
        fileType: mimeType,
        storyId,
        folder_structure: "chatbot/storymedia/",
      });

      if (!presigned) {
        await whatsappService.sendMessage(
          phoneNumber,
          `❌ ${selectedLanguageText.imageDownloadError}`,
        );
        return { success: false, handled: true };
      }

      // ── Step 4: PUT to S3 ────────────────────────────────────────
      const s3Url = await this._uploadToS3(
        presigned.uploadUrl,
        buffer,
        mimeType,
        fileName,
      );
      if (!s3Url) {
        await whatsappService.sendMessage(
          phoneNumber,
          `❌ ${selectedLanguageText.imageDownloadError}`,
        );
        return { success: false, handled: true };
      }

      // ── Step 5: Register with storymedia API ─────────────────────
      await this._registerStorymedia(phoneNumber, {
        file_url: presigned.s3Url,
        storyId,
        fileName,
        mimeType,
        sessionId: ctx.sessionId,
        flowName: ctx.flowName,
      });

      // ── Step 6: Update upload count in context ───────────────────
     


      // ── Delete temp file after successful S3 upload ──────────────
      if (filePath) {
        fs.unlink(filePath).catch((err) =>
          Logger.warn("Failed to delete temp file", {
            filePath,
            error: err.message,
          }),
        );
      }

      // ── Step 7: Acknowledge and ask for more / offer to finish ───
      const newCount = await usersQueries.incrementUploadCount(phoneNumber);

      // Re-read context to get expectedImageCount (set by album handler)
      const freshMsg = await usersQueries.getLastMessage(phoneNumber);
      const expectedImageCount = freshMsg?.context?.expectedImageCount || 0;

      Logger.info("Photo upload progress", {
        phoneNumber,
        newCount,
        expectedImageCount,
      });

      const allDone = expectedImageCount > 0 && newCount >= expectedImageCount;

      if (allDone || newCount >= MAX_PHOTOS) {
        // All album images uploaded — complete
        await whatsappService.sendMessage(
          phoneNumber,
          `✅ ${selectedLanguageText.reportGenerationMessage}`,
        );
        await this.handleUploadDone(phoneNumber);
      } else {
        // Still waiting for more images from the album
        Logger.info("Waiting for more album images", {
          phoneNumber,
          uploaded: newCount,
          expected: expectedImageCount,
        });
      }

      return { success: true, handled: true };
    } catch (error) {
      Logger.error("handlePhotoUpload error", {
        phoneNumber,
        error: error.message,
      });

      const keys = ["imageDownloadError"];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );
      await whatsappService.sendMessage(
        phoneNumber,
        `❌ ${selectedLanguageText.imageDownloadError}`,
      );
      return { success: false, handled: true };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 3.  User tapped "Done" or sent the text "done" / "skip"
  // ─────────────────────────────────────────────────────────────────
  async handleUploadDone(phoneNumber) {
    try {
      Logger.info("Upload done – fetching report", { phoneNumber });

      const lastMsg = await usersQueries.getLastMessage(phoneNumber);
      const ctx = lastMsg?.context || {};
      if (uploadDoneTimers.has(phoneNumber)) {
        clearTimeout(uploadDoneTimers.get(phoneNumber));
        uploadDoneTimers.delete(phoneNumber);
      }

      let storyId = ctx.storyId;
      if (!storyId) {
        storyId = await this._fetchStoryId(phoneNumber, ctx.sessionId);
      }

      await usersQueries.updateLastMessage(phoneNumber, {
        flow: "post_session_report",
        step: 3,
        context: { ...ctx, storyId },
        text: "upload_done",
      });

      const keys = [
        "downloadorEditReport",
        "storyText",
        "reportText",
        "downloadReportText",
        "downloadStoryText",
        "editReportText",
        "editStoryText",
      ];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );

      await whatsappService.sendInteractiveMessage({
        to: phoneNumber,
        type: "button",
        body: {
          text:
            `✅ ${ctx.flowName === "guest-mi-story" ? selectedLanguageText.storyText : selectedLanguageText.reportText}\n\n` +
            selectedLanguageText.downloadorEditReport,
        },
        action: {
         buttons: [
            {
              type: "quick_reply",
              title: `⬇️ ${ctx.flowName === "guest-mi-story" ? selectedLanguageText.downloadStoryText : selectedLanguageText.downloadReportText}`,
              id: "download_report",
            },
            // {
            //   type: "quick_reply",
            //   title: `✏️ ${ctx.flowName === "guest-mi-story" ? selectedLanguageText.editReportText : selectedLanguageText.editStoryText}`,
            //   id: "edit_report",
            // },
          ],
        },
      });

      return { success: true, handled: true };
    } catch (error) {
      Logger.error("handleUploadDone error", {
        phoneNumber,
        error: error.message,
      });
      return { success: false, handled: true };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 4.  User tapped "Download Report"
  // ─────────────────────────────────────────────────────────────────
  async handleDownloadReport(phoneNumber) {
    try {
      Logger.info("Downloading report", { phoneNumber });

      const lastMsg = await usersQueries.getLastMessage(phoneNumber);
      const ctx = lastMsg?.context || {};
      const sessionId = ctx.sessionId;
      const keys = [
        "reportLoader",
        "reportText",
        "storyText",
        "reportRetrievalError",
        "finishingGreet",
        "yes",
        "no",
      ];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );
      await whatsappService.sendMessage(
        phoneNumber,
        `⏳ ${selectedLanguageText.reportLoader}` ||
          `⏳ Generating your report. This may take a moment...`,
      );

      const story = await this._getStory(sessionId);
      if (!story) {
        await whatsappService.sendMessage(
          phoneNumber,
          `❌ ${selectedLanguageText.reportRetrievalError}`,
        );
        return { success: false, handled: true };
      }

      const storyId = story.id || ctx.storyId;

      const storyData = story?.results?.[0];
      const storyTitle = story.title || "Story_Report";

      // Find the PDF in story_media by media_type
      const pdfMedia = storyData?.story_media?.find(
        (m) =>
          m.media_type === "application/pdf" && m.include_in_story === false,
      );

      const pdfFileName = pdfMedia?.name;
      const pdfUrl = pdfMedia?.public_url;

      Logger.info("Sending report PDF", { phoneNumber, pdfUrl });

      await whatsappService.sendMediaMessage(
        phoneNumber,
        "document",
        pdfUrl,
        `📄 *${storyTitle}*\n\n ${selectedLanguageText.storyText}`,
      );

      await usersQueries.clearLastMessage(phoneNumber);

      // const mainMenuMsg = await languageService.buildMainMenuMessage(
      //   phoneNumber,
      //   selectedLanguageText.FinishingGreet,
      // );

      let FinishMessage = {
        to: phoneNumber,
        type: "button",
        body: {
          text:
            selectedLanguageText.finishingGreet ||
            "Do you want to record another story/discussion? ✍️📖",
        },
        action: {
          buttons: [
            {
              type: "quick_reply",
              title: selectedLanguageText.yes || " ✅ Yes",
              id: "yes_new_session",
            },
            {
              type: "quick_reply",
              title: selectedLanguageText.no || " ❌ No",
              id: "no_new_session",
            },
          ],
        },
      };
      await whatsappService.sendInteractiveMessage(FinishMessage);

      return { success: true, handled: true };
    } catch (error) {
      const keys = ["reportRetrievalError"];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );
      await whatsappService.sendMessage(
        phoneNumber,
        `❌ ${selectedLanguageText.reportRetrievalError}`,
      );
      return { success: false, handled: true };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 5.  User tapped "Edit Report"
  // ─────────────────────────────────────────────────────────────────
  async handleEditReport(phoneNumber) {
    try {
      const lastMsg = await usersQueries.getLastMessage(phoneNumber);
      const ctx = lastMsg?.context || {};
      const sessionId = ctx.sessionId;

      const keys = ["editReportText"];
      const selectedLanguageText = await languageService.tBatch(
        phoneNumber,
        keys,
      );

      const editUrl =
        `${process.env.BACKEND_API_URL}/mohini/guest-chat` +
        `?session=${sessionId}`;

      await whatsappService.sendMessage(
        phoneNumber,
        `✏️ ${selectedLanguageText.editReportText}:*\n\n${editUrl}\n\n` +
          `Open the link above to edit your discussion report in the browser.`,
      );

      return { success: true, handled: true };
    } catch (error) {
      Logger.error("handleEditReport error", {
        phoneNumber,
        error: error.message,
      });
      return { success: false, handled: true };
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────

  async _callEndStory(phoneNumber, session) {
    try {
      Logger.info("Calling end-story", {
        phoneNumber,
        sessionId: session.sessionId,
      });

      await axios.post(
        `${MOHINI_BASE_URL}/api/end-story/`,
        {
          session: session.sessionId,
          profile_id: session.profileId,
          stage: "COMPLETED",
          access_token: null,
          flow: session.flowName || "guest-discussion",
          language: session.language || "en",
        },
        {
          headers: {
            "Content-Type": "application/json",
            Origin: process.env.ORIGIN_URL,
          },
          timeout: 5000,
        },
      );

      Logger.info("end-story called successfully", { phoneNumber });
    } catch (error) {
      // Non-fatal – log and continue
      Logger.error("end-story API failed", {
        phoneNumber,
        error: error.message,
        status: error.response?.status,
      });
    }
  }

  async _askForPhotos(phoneNumber) {
    const keys = [
      "discussionRecorded",
      "add_photos",
      "uploadLimit",
      "yesUpload",
      "skip",
    ];
    const selectedLanguageText = await languageService.tBatch(
      phoneNumber,
      keys,
    );
    await whatsappService.sendInteractiveMessage({
      to: phoneNumber,
      type: "button",
      body: {
        text:
          `${selectedLanguageText.discussionRecorded}\n\n` +
          `📷 ${selectedLanguageText.add_photos} \n` +
          `${selectedLanguageText.uploadLimit} ${MAX_PHOTOS} images.`,
      },
      action: {
        buttons: [
          {
            type: "quick_reply",
            title: `${selectedLanguageText.yesUpload}`,
            id: "post_upload_yes",
          },
          {
            type: "quick_reply",
            title: `⏭️ ${selectedLanguageText.skip}`,
            id: "post_upload_skip",
          },
        ],
      },
    });
  }

  async _getStory(sessionId) {
    try {
      const resp = await axios.get(
        `${MOHINI_BASE_URL}/api/get-story/?session=${sessionId}`,
        {
          headers: {
            Accept: "application/json, text/plain, */*",
            Origin: process.env.ORIGIN_URL,
          },
          timeout: 15000,
        },
      );
      Logger.info("get-story response", { sessionId, data: resp.data });
      return resp.data;
    } catch (error) {
      Logger.error("get-story API failed", {
        sessionId,
        error: error.message,
        status: error.response?.status,
      });
      return null;
    }
  }

  async _getStoryUrl(storyId) {
    try {
      const resp = await axios.get(
        `${MOHINI_BASE_URL}/api/storymedia/?story=${storyId}`,
        {
          headers: {
            Accept: "application/json, text/plain, */*",
            Origin: process.env.ORIGIN_URL,
          },
          timeout: 15000,
        },
      );
      Logger.info("get-story response", { sessionId, data: resp.data });
      return resp.data;
    } catch (error) {
      Logger.error("get-story API failed", {
        sessionId,
        error: error.message,
        status: error.response?.status,
      });
      return null;
    }
  }

  async _fetchStoryId(phoneNumber, sessionId) {
    const story = await this._getStory(sessionId);
    if (!story?.results?.[0]?.id) {
      Logger.warn("No storyId in get-story response", { phoneNumber, story });
      return null;
    }
    return story.results[0].id;
  }

  async _getPresignedUrl(
    phoneNumber,
    { fileName, fileType, storyId, folder_structure },
  ) {
    try {
      const resp = await axios.post(
        `${MOHINI_BASE_URL}/api/get-presigned-url/`,
        { fileName, fileType, storyId, folder_structure },
        {
          headers: {
            "Content-Type": "application/json",
            Origin: process.env.ORIGIN_URL,
          },
          timeout: 15000,
        },
      );
      return {
        uploadUrl: resp.data.upload_url || resp.data.uploadUrl || resp.data.url,
        s3Url:
          resp.data.file_url ||
          resp.data.fileUrl ||
          resp.data.s3Url ||
          resp.data.s3_url,
      };
    } catch (error) {
      Logger.error("get-presigned-url failed", {
        phoneNumber,
        error: error.message,
        status: error.response?.status,
      });
      return null;
    }
  }

  async _uploadToS3(uploadUrl, buffer, mimeType, fileName) {
    try {
      Logger.info("Uploading to S3", {
        uploadUrl: uploadUrl?.substring(0, 60),
        size: buffer.length,
      });

      await axios.put(uploadUrl, buffer, {
        headers: {
          "Content-Type": mimeType,
          "Content-Length": buffer.length,
        },
        timeout: 60000,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });

      const parsed = new URL(uploadUrl);
      const cleanUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
      const s3Url = cleanUrl.replace("https://", "s3://");

      Logger.info("S3 upload complete", { s3Url });
      return s3Url;
    } catch (error) {
      Logger.error("S3 upload failed", {
        error: error.message,
        status: error.response?.status,
      });
      return null;
    }
  }

  async _registerStorymedia(
    phoneNumber,
    { file_url, storyId, fileName, mimeType, sessionId, flowName },
  ) {
    try {
      await axios.post(
        `${MOHINI_BASE_URL}/api/storymedia/`,
        {
          file_url,
          story: storyId,
          name: fileName,
          media_type: mimeType,
          include_in_story: true,
          access_token: null,
          flow: flowName || "guest-discussion",
          session: sessionId,
        },
        {
          headers: {
            "Content-Type": "application/json",
            Origin: process.env.ORIGIN_URL,
          },
          timeout: 100000,
        },
      );
      Logger.info("storymedia registered", { phoneNumber, storyId, fileName });
    } catch (error) {
      Logger.error("storymedia API failed", {
        phoneNumber,
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
      });
      // Non-fatal – image was uploaded to S3 even if registration fails
    }
  }

  async scheduleUploadDone(phoneNumber, handler, delayMs = 3000) {
    // Cancel any existing timer
    if (uploadDoneTimers.has(phoneNumber)) {
      clearTimeout(uploadDoneTimers.get(phoneNumber));
    }
    // Schedule a new one
    const timer = setTimeout(async () => {
      uploadDoneTimers.delete(phoneNumber);
      await handler();
    }, delayMs);
    uploadDoneTimers.set(phoneNumber, timer);
  }

  async _downloadWhatsAppImage(mediaId, fileName) {
    try {
      Logger.info("Downloading WhatsApp media", { fileName, mediaId });

      const config = require("../config/config");

      const response = await whatsappService.getMedia(mediaId);

      const buffer = Buffer.from(response.data);

      if (buffer.length > this.maxFileSize) {
        throw new Error("File size exceeds maximum limit of 25MB");
      }

      await fs.mkdir(this.tempDir, { recursive: true });

      const filePath = path.join(this.tempDir, fileName);
      await fs.writeFile(filePath, buffer);

      Logger.info("Media downloaded successfully", {
        fileName,
        size: buffer.length,
        path: filePath,
      });

      return { filePath, buffer, size: buffer.length };
    } catch (error) {
      Logger.error("Error downloading WhatsApp media", {
        error: error.message,
      });
      throw error;
    }
  }
  getFileExtension(mediaType) {
    const extensions = {
      image: "jpg",
      document: "pdf",
      video: "mp4",
      audio: "mp3",
    };
    return extensions[mediaType] || "bin";
  }
}

module.exports = new StoryPostSessionService();

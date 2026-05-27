// WhatsApp Media Upload Service
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class WhatsAppMediaHandler {
  constructor(elevateAuthToken, projectId) {
    this.elevateAuthToken = elevateAuthToken;
    this.projectId = projectId;
    this.preSignedUrlEndpoint = `${process.env.BACKEND_API_URL}/project/v1/cloud-services/files/preSignedUrls`;
    this.uploadEndpoint = 'https://storage.googleapis.com';
  }

  // Generate random unique ID
  generateRandomId() {
    return Math.random().toString(36).substring(2, 15) + 
           Math.random().toString(36).substring(2, 15);
  }

  // Make API request (your existing method)
  async makeApiRequest(method, url, authToken, data = null, headers = {}) {
    try {
      const config = {
        method,
        url,
        headers: {
          'Content-Type': 'application/json',
          'authorization': `Bearer ${authToken}`,
          'x-auth-token': authToken,
          ...headers
        }
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      return response.data;
    } catch (error) {
      console.error('API Request Error:', error.response?.data || error.message);
      throw error;
    }
  }

  // Download media from WhatsApp
  async downloadWhatsAppMedia(mediaUrl) {
    try {
      const response = await axios.get(mediaUrl, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'WhatsApp-Bot/1.0'
        }
      });
      return response.data;
    } catch (error) {
      console.error('Media Download Error:', error.message);
      throw error;
    }
  }

  // Get presigned URL from your service
  async getPresignedUrl(fileName) {
    try {
      const requestPayload = {
        request: {
          [this.projectId]: {
            files: [fileName]
          }
        }
      };

      const response = await this.makeApiRequest(
        'POST',
        this.preSignedUrlEndpoint,
        this.elevateAuthToken,
        requestPayload
      );

      if (response.status === 200 && response.result) {
        const fileData = response.result[this.projectId]?.files?.[0];
        if (fileData?.url) {
          return {
            fileName,
            uploadUrl: fileData.url,
            sourcePath: fileData.payload.sourcePath
          };
        }
      }
      throw new Error('Failed to get presigned URL');
    } catch (error) {
      console.error('Presigned URL Error:', error.message);
      throw error;
    }
  }

  // Upload file to Google Cloud Storage via presigned URL
  async uploadToCloudStorage(presignedUrl, fileBuffer, fileName) {
    try {
      const response = await axios.put(presignedUrl, fileBuffer, {
        headers: {
          'Content-Type': this.getContentType(fileName)
        }
      });
      return {
        success: true,
        message: 'File uploaded successfully',
        uploadUrl: presignedUrl.split('?')[0] // Remove query params for clean URL
      };
    } catch (error) {
      console.error('Cloud Upload Error:', error.message);
      throw error;
    }
  }

  // Determine content type from file name
  getContentType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  // Main handler for incoming media
  async handleIncomingMedia(message, whatsappService, phoneNumber) {
    try {
      const type = message.type; // 'image', 'video', 'audio', 'document'
      const mediaData = message[type];

      if (!mediaData?.link) {
        throw new Error(`No media link found for type: ${type}`);
      }

      // Step 1: Download media from WhatsApp
      console.log('Downloading media from WhatsApp...');
      const mediaBuffer = await this.downloadWhatsAppMedia(mediaData.link);

      // Step 2: Generate unique filename with random ID
      const timestamp = Date.now();
      const randomId = this.generateRandomId();
      const fileName = `${timestamp}-${randomId}.${this.getFileExtension(type, mediaData.caption)}`;

      // Step 3: Get presigned URL
      console.log('Getting presigned URL...');
      const presignedData = await this.getPresignedUrl(fileName);

      // Step 4: Upload to cloud storage
      console.log('Uploading to cloud storage...');
      const uploadResult = await this.uploadToCloudStorage(
        presignedData.uploadUrl,
        mediaBuffer,
        fileName
      );

      // Step 5: Send success response to user
      const successMessage = `✅ ${type.charAt(0).toUpperCase() + type.slice(1)} uploaded successfully!\n\nFile: ${fileName}\nPath: ${presignedData.sourcePath}`;

      await whatsappService.sendMessage(phoneNumber, successMessage);

      // Step 6: Log the upload
      console.log('Upload completed:', {
        phoneNumber,
        type,
        fileName,
        sourcePath: presignedData.sourcePath,
        timestamp
      });

      return {
        success: true,
        data: {
          fileName,
          type,
          sourcePath: presignedData.sourcePath,
          uploadUrl: uploadResult.uploadUrl
        }
      };

    } catch (error) {
      console.error('Media handling error:', error.message);
      
      // Send error message to user
      const errorMessage = `❌ Failed to upload ${message.type}. Please try again.\n\nError: ${error.message}`;
      await whatsappService.sendMessage(phoneNumber, errorMessage);

      return {
        success: false,
        error: error.message
      };
    }
  }

  // Get file extension from type and caption
  getFileExtension(type, caption = '') {
    if (caption) {
      const ext = path.extname(caption);
      if (ext) return ext.substring(1);
    }

    const extensions = {
      'image': 'jpg',
      'video': 'mp4',
      'audio': 'mp3',
      'document': 'pdf'
    };
    return extensions[type] || 'bin';
  }
}

// Usage in your WhatsApp message handler
async function handleWhatsAppMessage(message, phoneNumber, whatsappService) {
  const mediaHandler = new WhatsAppMediaHandler(
    process.env.ELEVATE_AUTH_TOKEN,
    process.env.PROJECT_ID, // Your project ID from message
    process.env.USER_ID     // The user ID from message
  );

  // Check if message contains media
  if (['image', 'video', 'audio', 'document'].includes(message.type)) {
    const result = await mediaHandler.handleIncomingMedia(
      message,
      whatsappService,
      phoneNumber
    );
    return result;
  }

  // Handle text messages
  // ... your existing text handler code
}

module.exports = WhatsAppMediaHandler;
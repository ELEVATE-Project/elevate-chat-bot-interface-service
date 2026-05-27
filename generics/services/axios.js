const axios = require("axios");

/**
 * Generic function for making API calls
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} url - API endpoint
 * @param {object} headers - Request headers
 * @param {object} body - Request payload (for POST/PUT)
 * @returns {Promise<object>}
 */

async function makeApiRequest(method, url, token, body = {}) {
  try {
    const headers = {
      "Content-Type": "application/json",
      "x-auth-token": token,
    };

    if(method.toUpperCase() == "GET"){
      headers["x-app-ver"]=""
    }

    const options = {
      method,
      url,
      headers,
    };

    if (method.toUpperCase() !== "GET") {
      options.data = body;
    }

    
    const response = await axios(options);


    return {
      success: true,
      data: response.data,
      status: response.status,
    };
  } catch (error) {
    console.error(
      `API request failed [${method}] ${url}`,
      error.response?.data || error.message
    );
    return {
      success: false,
      status: error.response?.status || 500,
      error: error.response?.data || error.message,
    };
  }
}

async function downloadBinaryFile(url) {
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    return {
      success: true,
      data: response.data,
      status: response.status,
    };
  } catch (error) {
    return {
      success: false,
      status: error.response?.status || 500,
      error: error.response?.data || error.message,
    };
  }
}

module.exports = { makeApiRequest, downloadBinaryFile };

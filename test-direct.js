const axios = require("axios");
const https = require("https");
const dns = require("dns");

dns.setDefaultResultOrder("ipv4first");

async function testDirect() {

  try {
    const payload = {
      to: "916379552738@s.whatsapp.net",
      type: "list", // 👈 Whapi now expects type here (list, button, product)
      header: {
        text: "Project Actions",
      },
      body: {
        text: "Welcome back, Praveen Dass! Please choose one of the following options 👇",
      },
      footer: {
        text: "Shikshalokam Assistant",
      },
      action: {
        list: {
          label: "Select Option",
          sections: [
            {
              title: "Available Actions",
              rows: [
                {
                  title: "🆕 Start a New Project",
                  description: "Create a new initiative from scratch.",
                  id: "start_new_project",
                },
                {
                  title: "🛠️ Update Existing Project",
                  description: "Modify an already created project.",
                  id: "update_existing_project",
                },
                {
                  title: "🎤 Record Story",
                  description: "Capture and submit your success stories.",
                  id: "record_story",
                },
                {
                  title: "📊 View Analytics",
                  description: "See project data and insights.",
                  id: "view_analytics",
                },
                {
                  title: "👤 Update Profile",
                  description: "Edit your user information.",
                  id: "update_profile",
                },
              ],
            },
          ],
        },
      },
    };

    const response = await axios.post(
      "https://gate.whapi.cloud/messages/interactive",
      payload,
      {
        headers: {
          Authorization: "Bearer Euq8h0PMX6Wc2Qdhr9OAh7SZiYBR8pKp",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        httpsAgent: new https.Agent({
          family: 4,
          timeout: 30000,
        }),
      }
    );

  } catch (error) {
    console.error("❌ FAILED:", error.response?.status || "Network Error");
    console.error(JSON.stringify(error.response?.data || error.message, null, 2));
  }
}

testDirect();

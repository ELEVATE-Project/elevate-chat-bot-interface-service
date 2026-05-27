

module.exports = {
  type: "list",
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

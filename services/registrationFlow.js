// registrationFlow.js
const RegistrationFlow = {
  steps: [
    "awaiting_registration_type",
    "awaiting_name",
    "awaiting_stakeholderType",
    "awaiting_udise_or_state",
    "awaiting_state",
    "awaiting_district",
    "awaiting_block",
    "awaiting_cluster",
    "awaiting_confirmation",
    "completed"
  ],

  async handle(user, message, sendMessage) {
    const progress = user.registrationProgress || "awaiting_registration_type";
    const text = message.trim().toLowerCase();

    switch (progress) {
      // Step 1️⃣ Ask user how they want to register
      case "awaiting_registration_type":
        await sendMessage(user.phoneNumber,
          "Would you like to register using your *UDISE Code* or *State Details*?"
        );
        user.registrationProgress = "awaiting_udise_or_state";
        break;

      // Step 2️⃣ If UDISE registration
      case "awaiting_udise_or_state":
        if (text.includes("udise")) {
          user.registrationData.registrationType = "UDISE";
          user.registrationProgress = "awaiting_name";
          await sendMessage(user.phoneNumber, "Please share your *Name*.");
        } else if (text.includes("state")) {
          user.registrationData.registrationType = "STATE";
          user.registrationProgress = "awaiting_name";
          await sendMessage(user.phoneNumber, "Please share your *Name*.");
        } else {
          await sendMessage(user.phoneNumber, "Please reply with *UDISE* or *State*.");
        }
        break;

      // Step 3️⃣ Name
      case "awaiting_name":
        if (!message.trim()) {
          await sendMessage(user.phoneNumber, "Name is required. Please enter your name.");
          break;
        }
        user.registrationData.name = message.trim();
        user.registrationProgress = "awaiting_stakeholderType";
        await sendMessage(user.phoneNumber, "Please select your *Stakeholder Type* (e.g., Teacher, HM, DEO, etc.)");
        break;

      // Step 4️⃣ Stakeholder type
      case "awaiting_stakeholderType":
        user.registrationData.stakeholderType = message.trim();
        if (user.registrationData.registrationType === "UDISE") {
          user.registrationProgress = "awaiting_udise";
          await sendMessage(user.phoneNumber, "Please share your *UDISE Code*.");
        } else {
          user.registrationProgress = "awaiting_state";
          await sendMessage(user.phoneNumber, "Which *State* are you from?");
        }
        break;

      // Step 5️⃣ UDISE flow
      case "awaiting_udise":
        user.registrationData.udise = message.trim();
        user.registrationProgress = "awaiting_confirmation";
        await this.askConfirmation(user, sendMessage);
        break;

      // Step 6️⃣ State flow
      case "awaiting_state":
        user.registrationData.state = message.trim();
        user.registrationProgress = "awaiting_district";
        await sendMessage(user.phoneNumber, "Please select your *District*.");
        break;

      case "awaiting_district":
        user.registrationData.district = message.trim();
        user.registrationProgress = "awaiting_block";
        await sendMessage(user.phoneNumber, "Please select your *Block*.");
        break;

      case "awaiting_block":
        user.registrationData.block = message.trim();
        user.registrationProgress = "awaiting_cluster";
        await sendMessage(user.phoneNumber, "Please select your *Cluster*.");
        break;

      case "awaiting_cluster":
        user.registrationData.cluster = message.trim();
        user.registrationProgress = "awaiting_confirmation";
        await this.askConfirmation(user, sendMessage);
        break;

      // Step 7️⃣ Confirm details
      case "awaiting_confirmation":
        if (["yes", "y", "confirm"].includes(text)) {
          user.registrationProgress = "completed";
          await sendMessage(user.phoneNumber, "✅ Registration successful! Welcome aboard.");
        } else if (["no", "n"].includes(text)) {
          await sendMessage(user.phoneNumber, "Okay, let's start again. Please share your *Name*.");
          user.registrationProgress = "awaiting_name";
        } else {
          await sendMessage(user.phoneNumber, "Please reply with *Yes* or *No* to confirm your details.");
        }
        break;

      case "completed":
        await sendMessage(user.phoneNumber, "You are already registered. How can I assist you today?");
        break;
    }

    user.lastInteractionAt = new Date();
    await user.save();
  },

  async askConfirmation(user, sendMessage) {
    const d = user.registrationData;
    let summary = `Please confirm your details:\n\n`;
    if (d.registrationType) summary += `Type: ${d.registrationType}\n`;
    if (d.name) summary += `Name: ${d.name}\n`;
    if (d.stakeholderType) summary += `Stakeholder: ${d.stakeholderType}\n`;
    if (d.udise) summary += `UDISE: ${d.udise}\n`;
    if (d.state) summary += `State: ${d.state}\n`;
    if (d.district) summary += `District: ${d.district}\n`;
    if (d.block) summary += `Block: ${d.block}\n`;
    if (d.cluster) summary += `Cluster: ${d.cluster}\n`;

    summary += `\nPlease reply *Yes* or *No*.`;
    await sendMessage(user.phoneNumber, summary);
  }
};

module.exports = RegistrationFlow;

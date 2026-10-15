// User ink and agent ink are separate lists drawn on one canvas.
class Board {
  constructor() {
    this.user = [];
    this.agent = [];
    // Checked by default once the board has ink, until the user toggles it.
    this.attach = false;
    this.userTouchedAttach = false;
  }

  hasContent() {
    return this.user.length + this.agent.length > 0;
  }

  noteContent() {
    if (!this.userTouchedAttach) this.attach = this.hasContent();
    if (!this.hasContent()) this.attach = false;
  }

  addUser(stroke) {
    if (!stroke || !Array.isArray(stroke.points) || stroke.points.length < 2) return;
    this.user.push({ points: stroke.points, color: '#e2a23a', width: 3.5 });
    this.noteContent();
  }

  setAgent(strokes) {
    this.agent = (strokes || [])
      .filter((s) => s && Array.isArray(s.points) && s.points.length >= 2)
      .map((s) => ({ points: s.points, color: '#ff3d7f', width: 3, dash: [8, 6] }));
    this.noteContent();
  }

  clearUser() {
    this.user = [];
    this.noteContent();
  }

  clearAgent() {
    this.agent = [];
    this.noteContent();
  }

  clearAll() {
    this.user = [];
    this.agent = [];
    this.attach = false;
  }

  setAttach(on, { touched } = {}) {
    if (touched) this.userTouchedAttach = true;
    this.attach = !!on && this.hasContent();
  }

  snapshot() {
    return {
      user: this.user,
      agent: this.agent,
      hasContent: this.hasContent(),
      attach: this.attach && this.hasContent(),
    };
  }
}

module.exports = { Board };

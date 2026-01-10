const PTSLogger = {
  log: (msg, ...args) =>
    console.log(
      "%cPoi Tagger Search |%c " + msg,
      "color:#4da6ff;font-weight:bold;",
      "color:inherit;",
      ...args
    ),

  warn: (msg, ...args) =>
    console.warn(
      "%cPoi Tagger Search |%c " + msg,
      "color:#f0ad4e;font-weight:bold;",
      "color:inherit;",
      ...args
    ),

  error: (msg, ...args) =>
    console.error(
      "%cPoi Tagger Search |%c " + msg,
      "color:#d9534f;font-weight:bold;",
      "color:inherit;",
      ...args
    )
};

export default PTSLogger;

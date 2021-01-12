import * as React from "react";
import wretch from "wretch";

import captionProgramDefaults, {
  CancelablePromise,
  getMsTimestampValue,
  getRandomListItem,
  getTimeout,
  getTimingFromString,
  htmlEntities
} from "../../data/utils";
import {TF} from "../../data/const";
import Tag from "../../data/Tag";
import ChildCallbackHack from "./ChildCallbackHack";
import Audio from "../../data/Audio";

const splitFirstWord = function (s: string) {
  const firstSpaceIndex = s.indexOf(" ");
  if (firstSpaceIndex > 0 && firstSpaceIndex < s.length - 1) {
    const first = s.substring(0, firstSpaceIndex);
    const rest = s.substring(firstSpaceIndex + 1);
    return [first, rest];
  } else {
    return [s, null];
  }
};

const getFirstWord = function (s: string) {
  return splitFirstWord(s)[0];
};

const getRest = function (s: string) {
  return splitFirstWord(s)[1];
};

export default class CaptionProgram extends React.Component {
  readonly el = React.createRef<HTMLDivElement>();

  readonly props: {
    blinkColor: string,
    blinkFontSize: number,
    blinkFontFamily: string,
    blinkBorder: boolean,
    blinkBorderpx: number,
    blinkBorderColor: string,
    captionColor: string,
    captionFontSize: number,
    captionFontFamily: string,
    captionBorder: boolean,
    captionBorderpx: number,
    captionBorderColor: string,
    captionBigColor: string,
    captionBigFontSize: number,
    captionBigFontFamily: string,
    captionBigBorder: boolean,
    captionBigBorderpx: number,
    captionBigBorderColor: string,
    countColor: string,
    countFontSize: number,
    countFontFamily: string,
    countBorder: boolean,
    countBorderpx: number,
    countBorderColor: string,
    url: string,
    script: string,
    timeToNextFrame: number,
    currentAudio: Audio
    currentImage: HTMLImageElement | HTMLVideoElement,
    textEndStop: boolean,
    textNextScene: boolean,
    getTags(source: string, clipID?: string): Array<Tag>,
    goBack(): void,
    playNextScene(): void,
    jumpToHack?: ChildCallbackHack,
    getCurrentTimestamp?(): number,
    onError?(e: string): void,
  };

  readonly state = {...captionProgramDefaults};

  _runningPromise: CancelablePromise = null;
  _timeout: any = null;

  render() {
    return (
      <div style={{
        zIndex: 6,
        pointerEvents: 'none',
        display: 'table',
        width: '100%',
        height: '100%',
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        overflow: 'hidden',
      }}>
        <div ref={this.el}/>
      </div>
    );
  }

  componentDidMount() {
    this.start();
    if (this.props.jumpToHack) {
      this.props.jumpToHack.listener = (args) => {
        this.setState({programCounter: args[0]});
      }
    }
  }

  componentWillUnmount() {
    this.reset();
    this.stop();
  }

  shouldComponentUpdate(props: any, state: any): boolean {
    return props.url !== this.props.url || props.script !== this.props.script ||
      props.currentImage !== this.props.currentImage || props.getCurrentTimestamp !== this.props.getCurrentTimestamp;
  }

  _sceneCommand: Function = null;
  componentDidUpdate(props: any, state: any) {
    if (this.props.currentImage !== props.currentImage && this._sceneCommand != null) {
      const command = this._sceneCommand;
      this._sceneCommand = null;
      command();
    }
    if (!this.el.current || (this.props.url == props.url && this.props.script == props.script
      && this.props.getCurrentTimestamp === props.getCurrentTimestamp)) return;
    this.stop();
    this.reset();
    this.start();
  }

  reset() {
    this.setState({...captionProgramDefaults, phrases: new Map<number, Array<string>>()});
  }

  stop() {
    if (this.el) {
      this.el.current.style.opacity = '0';
    }
    if (this._runningPromise) {
      this._runningPromise.cancel();
      this._runningPromise = null;
    }
    if (this._timeout) {
      clearTimeout(this._timeout);
      this._timeout = null;
    }
    this._sceneCommand = null;
    this._timeStarted = null;
    this._lastTimestamp = null;
    this._nextTimestamp = null;
    if (this._timestampTimeout) {
      clearTimeout(this._timestampTimeout);
      this._timestampTimeout = null;
    }
  }

  start() {
    const url = this.props.url;
    this._runningPromise = new CancelablePromise((resolve, reject) => {
      if (this.props.script != null) {
        resolve({data: [this.props.script], helpers: null});
      } else {
        wretch(url)
          .get()
          .error(503, error => {
            console.warn("Unable to access " + url + " - Service is unavailable");
          })
          .text(data => {
            resolve({data: [data], helpers: null});
          });
      }
    });
    this._runningPromise.then((data) => {
      let error = null;
      let newProgram = new Array<Function>();
      let newTimestamps = new Map<number, Function>();
      let index = 0;
      let containsTimestampAction = false;
      let containsAction = false;

      for (let line of data.data[0].split('\n')) {
        index++;
        line = line.trim();

        if (line.length == 0 || line[0] == '#') continue;
        let command = getFirstWord(line);
        let value = getRest(line);

        let timestamp = getMsTimestampValue(command);
        if (timestamp != null && value != null && value.length > 0) {
          line = value;
          command = getFirstWord(line);
          value = getRest(line);
        }

        let fn, ms;
        switch (command) {
          case "count":
            if (value == null) {
              error = "Error: {" + index + "} '" + line + "' - missing parameters";
              break;
            }
            const split = value.split(" ");
            if (split.length < 2) {
              error = "Error: {" + index + "} '" + line + "' - missing second parameter";
              break;
            }
            if (split.length > 2) {
              error = "Error: {" + index + "} '" + line + "' - extra parameter(s)";
              break;
            }
            let start = parseInt(split[0]);
            const end = parseInt(split[1]);
            if (/^\d+\s*$/.exec(split[0]) == null || /^\d+\s*$/.exec(split[1]) == null ||
              isNaN(start) || isNaN(end) || start < 0 || end < 0) {
              error = "Error: {" + index + "} '" + line + "' - invalid count command";
              break;
            }
            if (timestamp != null) {
              if (newTimestamps.has(timestamp)) {
                error = "Error: {" + index + "} '" + line + "' - duplicate timestamps";
                break;
              }
              containsTimestampAction = true;
              newTimestamps.set(timestamp, this.count(start, end, true));
            } else {
              containsAction = true;
              newProgram.push(this.count(start, end));
            }
            break;
          case "blink":
          case "cap":
          case "bigcap":
            if (value == null) {
              error = "Error: {" + index + "} '" + line + "' - missing parameter";
              break;
            }
            let rr;
            if (command == "blink") {
              rr = /(?:^|[\/\s])(\$RANDOM_PHRASE|\$\d)(?:[\/\s]|$)/g;
            } else {
              rr = /(?:^|\s)(\$RANDOM_PHRASE|\$\d)(?:\s|$)/g;
            }
            let rrE;
            while ( (rrE = rr.exec(value)) ) {
              let register;
              if (rrE[1] == "$RANDOM_PHRASE") {
                register = 0;
              } else {
                register = parseInt(rrE[1].substring(1, 2));
              }
              if (!this.state.phrases.has(register)) {
                error = "Error: {" + index + "} '" + line + "' - no phrases stored" + (register == 0 ? "" : " in group " + register);
                break;
              }
            }
            if (error != null) break;
            if (timestamp != null) {
              if (newTimestamps.has(timestamp)) {
                error = "Error: {" + index + "} '" + line + "' - duplicate timestamps";
                break;
              }
              containsTimestampAction = true;
              newTimestamps.set(timestamp, (this as any)[command](value, true));
            } else {
              containsAction = true;
              newProgram.push((this as any)[command](value));
            }
            break;
          case "storephrase":
          case "storePhrase":
            if (value == null) {
              error = "Error: {" + index + "} '" + line + "' - missing parameter";
              break;
            }
            const newPhrases = this.state.phrases;
            const registerRegex = /^\$(\d)\s.*$/.exec(value);
            if (registerRegex != null) {
              const register = parseInt(registerRegex[1]);
              if (register != 0) {
                value = value.replace("$" + register + " ", "");
                if (!newPhrases.has(register)) {
                  newPhrases.set(register, []);
                }
                newPhrases.set(register, newPhrases.get(register).concat([value]));
              }
            }
            if (!newPhrases.has(0)) {
              newPhrases.set(0, []);
            }
            newPhrases.set(0, newPhrases.get(0).concat([value]));
            this.setState({phrases: newPhrases});
            break;
          case "setBlinkDuration":
          case "setBlinkDelay":
          case "setBlinkGroupDelay":
          case "setCaptionDuration":
          case "setCaptionDelay":
          case "setCountDuration":
          case "setCountDelay":
          case "setCountGroupDelay":
            if (value == null) {
              error = "Error: {" + index + "} '" + line + "' - missing parameters";
              break;
            } else if (value.split(" ").length > 2) {
              error = "Error: {" + index + "} '" + line + "' - extra parameter(s)";
              break;
            } else if (/^\d+\s*\d*\s*$/.exec(value) == null) {
              error = "Error: {" + index + "} '" + line + "' - invalid command";
              break;
            }
            const numbers: Array<any> = value.split(" ");
            let invalid = false;
            for (let n = 0; n<numbers.length; n++) {
              ms = parseInt(numbers[n]);
              if (isNaN(ms)) {
                error = "Error: {" + index + "} '" + line + "' - invalid command";
                invalid = true;
                break;
              }
              numbers[n] = ms;
            }
            if (invalid) break;
            fn = (this as any)[command](numbers);
            if (timestamp != null) {
              if (newTimestamps.has(timestamp)) {
                error = "Error: {" + index + "} '" + line + "' - duplicate timestamps";
                break;
              }
              newTimestamps.set(timestamp, fn);
            } else {
              newProgram.push(fn);
            }
            break;
          case "setBlinkWaveRate":
          case "setBlinkBPMMulti":
          case "setBlinkDelayWaveRate":
          case "setBlinkDelayBPMMulti":
          case "setBlinkGroupDelayWaveRate":
          case "setBlinkGroupDelayBPMMulti":
          case "setCaptionWaveRate":
          case "setCaptionBPMMulti":
          case "setCaptionDelayWaveRate":
          case "setCaptionDelayBPMMulti":
          case "setCountWaveRate":
          case "setCountBPMMulti":
          case "setCountDelayWaveRate":
          case "setCountDelayBPMMulti":
          case "setCountGroupDelayWaveRate":
          case "setCountGroupDelayBPMMulti":
          case "wait":
            if (value == null) {
              error = "Error: {" + index + "} '" + line + "' - missing parameter";
              break;
            } else if (value.includes(" ")) {
              error = "Error: {" + index + "} '" + line + "' - extra parameter(s)";
              break;
            } else if (/^\d+\s*$/.exec(value) == null) {
              error = "Error: {" + index + "} '" + line + "' - invalid command";
              break;
            }
            ms = parseInt(value);
            if (isNaN(ms)) {
              error = "Error: {" + index + "} '" + line + "' - invalid command";
              break;
            }
            fn = (this as any)[command](ms);
            if (timestamp != null) {
              if (newTimestamps.has(timestamp)) {
                error = "Error: {" + index + "} '" + line + "' - duplicate timestamps";
                break;
              }
              newTimestamps.set(timestamp, fn);
            } else {
              newProgram.push(fn);
            }
            break;
          case "setBlinkTF":
          case "setBlinkDelayTF":
          case "setBlinkGroupDelayTF":
          case "setCaptionTF":
          case "setCaptionDelayTF":
          case "setCountTF":
          case "setCountDelayTF":
          case "setCountGroupDelayTF":
            if (value == null) {
              error = "Error: {" + index + "} '" + line + "' - missing parameter";
              break;
            }
            const tf = getTimingFromString(value);
            if (tf == null) {
              error = "Error: {" + index + "} '" + line + "' - invalid timing function";
              break;
            }
            fn = (this as any)[command](tf);
            if (timestamp != null) {
              if (newTimestamps.has(timestamp)) {
                error = "Error: {" + index + "} '" + line + "' - duplicate timestamps";
                break;
              }
              newTimestamps.set(timestamp, fn);
            } else {
              newProgram.push(fn);
            }
            break;
          default:
            error = "Error: {" + index + "} '" + line + "' - unknown command";
        }
        if (error != null) {
          break;
        }
      }

      if (error == null && (containsAction || containsTimestampAction)) {
        if (newTimestamps.size > 0 && containsAction && containsTimestampAction) {
          this.setState({program: newProgram, timestampFn: newTimestamps, timestamps: Array.from(newTimestamps.keys()).sort((a, b) => {
              if (a > b) {
                return 1;
              } else if (a < b) {
                return -1;
              } else {
                return 0;
              }
            })});
          this._timeStarted = new Date();
          this.timestampLoop();
          this.captionLoop();
        } else if (newTimestamps.size > 0 && containsTimestampAction) {
          this.setState({timestampFn: newTimestamps, timestamps: Array.from(newTimestamps.keys()).sort((a, b) => {
              if (a > b) {
                return 1;
              } else if (a < b) {
                return -1;
              } else {
                return 0;
              }
            })});
          this._timeStarted = new Date();
          this.timestampLoop();
        } else if (containsAction) {
          this.setState({program: newProgram});
          this.captionLoop();
        }
      } else if (this.props.onError) {
        if (this.props.onError) {
          this.props.onError(error);
        } else {
          console.error(error);
        }
      }
    })
  }

  _timeStarted: Date = null;
  _nextTimestamp: number = null;
  _lastTimestamp: number = null;
  _timestampTimeout: NodeJS.Timeout = null;
  timestampLoop() {
    if (this.props.getCurrentTimestamp) {
      const passed = this.props.getCurrentTimestamp();
      if (this._lastTimestamp == null || Math.abs(this._lastTimestamp - passed) > 1000) {
        // Timestamp has changed, reset
        let index = 0;
        do {
          if (this.state.timestamps.length >= index &&
            passed > this.state.timestamps[index + 1]) {
            index++;
          } else {
            this._nextTimestamp = this.state.timestamps[index];
            break;
          }
        } while (true)
        this.setState({timestampCounter: index});
      } else if (passed >  this._nextTimestamp) {
        let index = this.state.timestampCounter;
        let fn;
        do {
          if (this.state.timestamps.length >= index &&
            passed > this.state.timestamps[index + 1]) {
            index++;
          } else {
            fn = this.state.timestampFn.get(this.state.timestamps[index]);
            this._nextTimestamp = this.state.timestamps[index + 1];
            break;
          }
        } while (true)

        fn(() => {
          let newCounter = index
          if (newCounter >= this.state.timestamps.length) {
            if (this.props.textEndStop) {
              this.props.goBack();
              return;
            }
            if (this.props.textNextScene && this.props.playNextScene) {
              this.props.playNextScene();
              return;
            }
          }
          this.setState({timestampCounter: newCounter});
        });
        if (index >= this.state.timestamps.length - 1) {
          this._nextTimestamp = 9999999;
        }
      }
      this._lastTimestamp = passed;
      this._timestampTimeout = setTimeout(this.timestampLoop.bind(this), 100);
    } else {
      if (this._nextTimestamp == null) {
        this._nextTimestamp = this.state.timestamps[this.state.timestampCounter];
      }
      const passed = (new Date().getTime() - this._timeStarted.getTime());
      if (passed > this._nextTimestamp) {
        let index = this.state.timestampCounter;
        let fn;
        do {
          if (this.state.timestamps.length >= index &&
            passed > this.state.timestamps[index + 1]) {
            index++;
          } else {
            fn = this.state.timestampFn.get(this.state.timestamps[index]);
            this._nextTimestamp = this.state.timestamps[index + 1];
            break;
          }
        } while (true)

        fn(() => {
          let newCounter = index
          if (newCounter >= this.state.timestamps.length) {
            if (this.props.textEndStop) {
              this.props.goBack();
              return;
            }
            if (this.props.textNextScene && this.props.playNextScene) {
              this.props.playNextScene();
              return;
            }
          }
          this.setState({timestampCounter: newCounter});
        });
        if (index >= this.state.timestamps.length - 1) {
          return;
        }
      }
      this._timestampTimeout = setTimeout(this.timestampLoop.bind(this), 100);
    }
  }

  captionLoop() {
    if (this.state.program[this.state.programCounter]) {
      this.state.program[this.state.programCounter](() => {
        let newCounter = this.state.programCounter + 1;
        if (newCounter >= this.state.program.length) {
          if (this.props.textEndStop) {
            this.props.goBack();
            return;
          }
          if (this.props.textNextScene && this.props.playNextScene) {
            this.props.playNextScene();
            return;
          }
          newCounter = 0;
        }
        this.setState({programCounter: newCounter});
        this.captionLoop();
      });
    }
  }

  getPhrase(value: string) {
    const registerRegex = /^\$(\d)$/.exec(value);
    if (value == "$RANDOM_PHRASE") {
      return getRandomListItem(this.state.phrases.get(0));
    } else if (registerRegex != null) {
      const register = parseInt(registerRegex[1]);
      return getRandomListItem(this.state.phrases.get(register));
    } else if (value == "$TAG_PHRASE") {
      if (this.props.currentImage) {
        const tag = getRandomListItem(this.props.getTags(this.props.currentImage.getAttribute("source"), this.props.currentImage.getAttribute("clip")).filter((t) => t.phraseString && t.phraseString != ""));
        if (tag) {
          const phraseString = tag.phraseString;
          return getRandomListItem(phraseString.split('\n'));
        }
      }
      return "";
    } else {
      return value;
    }
  }

  showText(value: string, ms: number) {
    return (nextCommand: Function) => {
      this.el.current.style.opacity = '1';
      this.el.current.innerHTML = htmlEntities(value);
      const wait = this.wait(ms);
      wait(() => {
        this.el.current.style.opacity = '0';
        nextCommand();
      });
    }
  }

  wait(ms: number) {
    return (nextCommand: Function) => { this._timeout = setTimeout(nextCommand, ms)};
  }

  cap(value: string, timestamp = false) {
    return (nextCommand: Function) => {
      let duration = getTimeout(this.state.captionTF, this.state.captionDuration[0], this.state.captionDuration[0],
        this.state.captionDuration[1], this.state.captionWaveRate, this.props.currentAudio,
        this.state.captionBPMMulti, this.props.timeToNextFrame);
      const showText = this.showText(this.getPhrase(value), duration);
      let delay = timestamp ? 0 : getTimeout(this.state.captionDelayTF, this.state.captionDelay[0], this.state.captionDelay[0],
        this.state.captionDelay[1], this.state.captionDelayWaveRate, this.props.currentAudio,
        this.state.captionDelayBPMMulti, this.props.timeToNextFrame);
      const wait = this.wait(delay);
      this.el.current.style.color = this.props.captionColor;
      this.el.current.style.fontSize = this.props.captionFontSize + "vmin";
      this.el.current.style.fontFamily = this.props.captionFontFamily;
      this.el.current.style.display = 'table-cell';
      this.el.current.style.textAlign = 'center';
      this.el.current.style.verticalAlign = 'bottom';
      this.el.current.style.paddingBottom = '20vmin';
      this.el.current.style.transition = 'opacity 0.5s ease-in-out';
      if (this.props.captionBorder) {
        this.el.current.style.webkitTextStroke = this.props.captionBorderpx + 'px ' + this.props.captionBorderColor;
      }
      if (this.state.captionDelayTF == TF.scene && !timestamp) {
        this._sceneCommand = () => {showText(() => nextCommand())};
      } else {
        showText(function() { wait(nextCommand); });
      }
    }
  }

  bigcap(value: string, timestamp = false) {
    return (nextCommand: Function) => {
      let duration = getTimeout(this.state.captionTF, this.state.captionDuration[0], this.state.captionDuration[0],
        this.state.captionDuration[1], this.state.captionWaveRate, this.props.currentAudio,
        this.state.captionBPMMulti, this.props.timeToNextFrame);
      const showText = this.showText(this.getPhrase(value), duration);
      let delay = timestamp ? 0 : getTimeout(this.state.captionDelayTF, this.state.captionDelay[0], this.state.captionDelay[0],
        this.state.captionDelay[1], this.state.captionDelayWaveRate, this.props.currentAudio,
        this.state.captionDelayBPMMulti, this.props.timeToNextFrame);
      const wait = this.wait(delay);
      this.el.current.style.color = this.props.captionBigColor;
      this.el.current.style.fontSize = this.props.captionBigFontSize + "vmin";
      this.el.current.style.fontFamily = this.props.captionBigFontFamily;
      this.el.current.style.display = 'table-cell';
      this.el.current.style.textAlign = 'center';
      this.el.current.style.verticalAlign = 'middle';
      this.el.current.style.paddingBottom = 'unset';
      this.el.current.style.transition = 'opacity 0.1s ease-out';
      if (this.props.captionBigBorder) {
        this.el.current.style.webkitTextStroke = this.props.captionBigBorderpx + 'px ' + this.props.captionBigBorderColor;
      }
      if (this.state.captionDelayTF == TF.scene && !timestamp) {
        this._sceneCommand = () => {showText(() => nextCommand())};
      } else {
        showText(function() { wait(nextCommand); });
      }

    }
  }

  blink(value: string, timestamp = false) {
    return (nextCommand: Function) => {
      let fns = new Array<Function>();
      let i = 0;
      const phrase = this.getPhrase(value).split('/')
      const length = phrase.length;
      for (let word of phrase) {
        word = this.getPhrase(word.trim());
        let j = i;
        i += 1;
        fns.push(() => {
          let duration = getTimeout(this.state.blinkTF, this.state.blinkDuration[0], this.state.blinkDuration[0],
              this.state.blinkDuration[1], this.state.blinkWaveRate, this.props.currentAudio,
              this.state.blinkBPMMulti, this.props.timeToNextFrame);
          const showText = this.showText(word, duration);
          if (j == length - 1 && (this.state.blinkDelayTF == TF.scene || this.state.blinkGroupDelayTF == TF.scene || timestamp)) {
            showText(() => nextCommand());
          } else if (this.state.blinkDelayTF == TF.scene) {
            showText(() => this._sceneCommand = fns[j + 1]);
          } else {
            let delay = getTimeout(this.state.blinkDelayTF, this.state.blinkDelay[0], this.state.blinkDelay[0],
              this.state.blinkDelay[1], this.state.blinkDelayWaveRate, this.props.currentAudio,
              this.state.blinkDelayBPMMulti, this.props.timeToNextFrame);
            const wait = this.wait(delay);
            showText(() => wait(fns[j + 1]));
          }
        })
      }

      if (this.state.blinkGroupDelayTF != TF.scene && this.state.blinkDelayTF != TF.scene && !timestamp) {
        let delay = getTimeout(this.state.blinkGroupDelayTF, this.state.blinkGroupDelay[0], this.state.blinkGroupDelay[0],
          this.state.blinkGroupDelay[1], this.state.blinkGroupDelayWaveRate, this.props.currentAudio,
          this.state.blinkGroupDelayBPMMulti, this.props.timeToNextFrame);
        const lastWait = this.wait(delay);
        fns.push(() => lastWait(nextCommand));
      }

      this.el.current.style.color = this.props.blinkColor;
      this.el.current.style.fontSize = this.props.blinkFontSize + "vmin";
      this.el.current.style.fontFamily = this.props.blinkFontFamily;
      this.el.current.style.display = 'table-cell';
      this.el.current.style.textAlign = 'center';
      this.el.current.style.verticalAlign = 'middle';
      this.el.current.style.paddingBottom = 'unset';
      this.el.current.style.transition = 'opacity 0.1s ease-out';
      if (this.props.blinkBorder) {
        this.el.current.style.webkitTextStroke = this.props.blinkBorderpx + 'px ' + this.props.blinkBorderColor;
      }
      if ((this.state.blinkGroupDelayTF == TF.scene || this.state.blinkDelayTF == TF.scene) && !timestamp) {
        this._sceneCommand = fns[0];
      } else {
        fns[0]();
      }
    }
  }

  count(start: number, end: number, timestamp = false) {
    let values = Array<number>();
    do {
      values.push(start);
      if (start == end) {
        break;
      } else if (start < end) {
        start+=1;
      } else if (start > end) {
        start-=1;
      }
    } while (true);

    return (nextCommand: Function) => {
      let fns = new Array<Function>();
      let i = 0;
      const length = values.length;
      for (let val of values) {
        let j = i;
        i += 1;
        fns.push(() => {
          let duration = getTimeout(this.state.countTF, this.state.countDuration[0], this.state.countDuration[0],
            this.state.countDuration[1], this.state.countWaveRate, this.props.currentAudio,
            this.state.countBPMMulti, this.props.timeToNextFrame);
          const showText = this.showText(val.toString(), duration);
          if (j == length - 1 && (this.state.countDelayTF == TF.scene || this.state.countGroupDelayTF == TF.scene || timestamp)) {
            showText(() => nextCommand());
          } else if (this.state.countDelayTF == TF.scene) {
            showText(() => this._sceneCommand = fns[j + 1]);
          } else {
            let delay = getTimeout(this.state.countDelayTF, this.state.countDelay[0], this.state.countDelay[0],
              this.state.countDelay[1], this.state.countDelayWaveRate, this.props.currentAudio,
              this.state.countDelayBPMMulti, this.props.timeToNextFrame);
            const wait = this.wait(delay);
            showText(() => wait(fns[j + 1]));
          }
        })
      }
      
      if (this.state.countGroupDelayTF != TF.scene && this.state.countDelayTF != TF.scene && !timestamp) {
        let delay = getTimeout(this.state.countGroupDelayTF, this.state.countGroupDelay[0], this.state.countGroupDelay[0],
          this.state.countGroupDelay[1], this.state.countGroupDelayWaveRate, this.props.currentAudio,
          this.state.countGroupDelayBPMMulti, this.props.timeToNextFrame);
        const lastWait = this.wait(delay);
        fns.push(() => lastWait(nextCommand));
      }

      this.el.current.style.color = this.props.countColor;
      this.el.current.style.fontSize = this.props.countFontSize + "vmin";
      this.el.current.style.fontFamily = this.props.countFontFamily;
      this.el.current.style.display = 'table-cell';
      this.el.current.style.textAlign = 'center';
      this.el.current.style.verticalAlign = 'middle';
      this.el.current.style.paddingBottom = 'unset';
      this.el.current.style.transition = 'opacity 0.1s ease-out';
      if (this.props.countBorder) {
        this.el.current.style.webkitTextStroke = this.props.countBorderpx + 'px ' + this.props.countBorderColor;
      }
      if ((this.state.countGroupDelayTF == TF.scene || this.state.countDelayTF == TF.scene) && !timestamp) {
        this._sceneCommand = fns[0];
      } else {
        fns[0]();
      }
    }
  }

  /* Blink */
  setBlinkDuration(ms: Array<number>) {
    return (nextCommand: Function) => {
      if (ms.length == 1) {
        ms.push(this.state.blinkDuration[1]);
      }
      this.setState({blinkDuration: ms});
      nextCommand();
    }
  }

  setBlinkWaveRate(waveRate: number) {
    return (nextCommand: Function) => {
      this.setState({blinkWaveRate: waveRate});
      nextCommand();
    }
  }

  setBlinkBPMMulti(bpmMulti: number) {
    return (nextCommand: Function) => {
      this.setState({blinkBPMMulti: bpmMulti});
      nextCommand();
    }
  }

  setBlinkTF(tf: string) {
    return (nextCommand: Function) => {
      this.setState({blinkTF: tf});
      nextCommand();
    }
  }

  /* Blink Delay */
  setBlinkDelay(ms: Array<number>) {
    return (nextCommand: Function) => {
      if (ms.length == 1) {
        ms.push(this.state.blinkDelay[1]);
      }
      this.setState({blinkDelay: ms});
      nextCommand();
    }
  }

  setBlinkDelayWaveRate(waveRate: number) {
    return (nextCommand: Function) => {
      this.setState({blinkDelayWaveRate: waveRate});
      nextCommand();
    }
  }

  setBlinkDelayBPMMulti(bpmMulti: number) {
    return (nextCommand: Function) => {
      this.setState({blinkDelayBPMMulti: bpmMulti});
      nextCommand();
    }
  }

  setBlinkDelayTF(tf: string) {
    return (nextCommand: Function) => {
      this.setState({blinkDelayTF: tf});
      nextCommand();
    }
  }

  /* Blink Group Delay*/
  setBlinkGroupDelay(ms: Array<number>) {
    return (nextCommand: Function) => {
      if (ms.length == 1) {
        ms.push(this.state.blinkGroupDelay[1]);
      }
      this.setState({blinkGroupDelay: ms});
      nextCommand();
    }
  }

  setBlinkGroupDelayWaveRate(waveRate: number) {
    return (nextCommand: Function) => {
      this.setState({blinkGroupDelayWaveRate: waveRate});
      nextCommand();
    }
  }

  setBlinkGroupDelayBPMMulti(bpmMulti: number) {
    return (nextCommand: Function) => {
      this.setState({blinkGroupDelayBPMMulti: bpmMulti});
      nextCommand();
    }
  }

  setBlinkGroupDelayTF(tf: string) {
    return (nextCommand: Function) => {
      this.setState({blinkGroupDelayTF: tf});
      nextCommand();
    }
  }

  /* Caption */
  setCaptionDuration(ms: Array<number>) {
    return (nextCommand: Function) => {
      if (ms.length == 1) {
        ms.push(this.state.captionDuration[1]);
      }
      this.setState({captionDuration: ms});
      nextCommand();
    }
  }

  setCaptionWaveRate(waveRate: number) {
    return (nextCommand: Function) => {
      this.setState({captionWaveRate: waveRate});
      nextCommand();
    }
  }

  setCaptionBPMMulti(bpmMulti: number) {
    return (nextCommand: Function) => {
      this.setState({captionBPMMulti: bpmMulti});
      nextCommand();
    }
  }

  setCaptionTF(tf: string) {
    return (nextCommand: Function) => {
      this.setState({captionTF: tf});
      nextCommand();
    }
  }

  /* Caption Delay */
  setCaptionDelay(ms: Array<number>) {
    return (nextCommand: Function) => {
      if (ms.length == 1) {
        ms.push(this.state.captionDelay[1]);
      }
      this.setState({captionDelay: ms});
      nextCommand();
    }
  }

  setCaptionDelayWaveRate(waveRate: number) {
    return (nextCommand: Function) => {
      this.setState({captionDelayWaveRate: waveRate});
      nextCommand();
    }
  }

  setCaptionDelayBPMMulti(bpmMulti: number) {
    return (nextCommand: Function) => {
      this.setState({captionDelayBPMMulti: bpmMulti});
      nextCommand();
    }
  }

  setCaptionDelayTF(tf: string) {
    return (nextCommand: Function) => {
      this.setState({captionDelayTF: tf});
      nextCommand();
    }
  }

  /* Count */
  setCountDuration(ms: Array<number>) {
    return (nextCommand: Function) => {
      if (ms.length == 1) {
        ms.push(this.state.countDuration[1]);
      }
      this.setState({countDuration: ms});
      nextCommand();
    }
  }

  setCountWaveRate(waveRate: number) {
    return (nextCommand: Function) => {
      this.setState({countWaveRate: waveRate});
      nextCommand();
    }
  }

  setCountBPMMulti(bpmMulti: number) {
    return (nextCommand: Function) => {
      this.setState({countBPMMulti: bpmMulti});
      nextCommand();
    }
  }
  
  setCountTF(tf: string) {
    return (nextCommand: Function) => {
      this.setState({countTF: tf});
      nextCommand();
    }
  }

  /* Count Delay */
  setCountDelay(ms: Array<number>) {
    return (nextCommand: Function) => {
      if (ms.length == 1) {
        ms.push(this.state.countDelay[1]);
      }
      this.setState({countDelay: ms});
      nextCommand();
    }
  }

  setCountDelayWaveRate(waveRate: number) {
    return (nextCommand: Function) => {
      this.setState({countDelayWaveRate: waveRate});
      nextCommand();
    }
  }

  setCountDelayBPMMulti(bpmMulti: number) {
    return (nextCommand: Function) => {
      this.setState({countDelayBPMMulti: bpmMulti});
      nextCommand();
    }
  }

  setCountDelayTF(tf: string) {
    return (nextCommand: Function) => {
      this.setState({countDelayTF: tf});
      nextCommand();
    }
  }

  /* Count Group Delay */
  setCountGroupDelay(ms: Array<number>) {
    return (nextCommand: Function) => {
      if (ms.length == 1) {
        ms.push(this.state.countGroupDelay[1]);
      }
      this.setState({countGroupDelay: ms});
      nextCommand();
    }
  }

  setCountGroupDelayWaveRate(waveRate: number) {
    return (nextCommand: Function) => {
      this.setState({countGroupDelayWaveRate: waveRate});
      nextCommand();
    }
  }

  setCountGroupDelayBPMMulti(bpmMulti: number) {
    return (nextCommand: Function) => {
      this.setState({countGroupDelayBPMMulti: bpmMulti});
      nextCommand();
    }
  }

  setCountGroupDelayTF(tf: string) {
    return (nextCommand: Function) => {
      this.setState({countGroupDelayTF: tf});
      nextCommand();
    }
  }
}
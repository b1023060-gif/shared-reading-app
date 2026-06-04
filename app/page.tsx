"use client";

import { dictionary } from "./dictionary";
import { stories, type StoryKey } from "./stories";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { db } from "./firebase";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  setDoc,
} from "firebase/firestore";

type Participant = {
  id: string;
  name: string;
  paragraphIndex: number;
  joinedAt: number;
  updatedAt: number;
};

type Reaction = {
  storyKey: StoryKey | "";
  emoji: string;
  comment: string;
  paragraphIndex: number;
  participantId: string;
  participantName: string;
  time: string;
  createdAt: number;
};

type ReaderMode = "reading" | "shared";
type LayoutMode = "normal" | "grouped";
type AutoSpeedMode = "slow" | "normal" | "fast";

type Paragraph = {
  text: string;
  isHeading?: boolean;
};

type ReadingUnit = {
  unitIndex: number;
  paragraphIndex: number;
  groupIndexInParagraph: number;
  firstSentence: string;
  secondSentence: string;
  html: string;
  isHeading?: boolean;
};

type ReadingProgress = {
  storyKey: StoryKey;
  layoutMode: LayoutMode;
  currentParagraphIndex: number;
  scrollLeft: number;
  savedAt: number;
  readingUnitsLength?: number;
  percent?: number;
};

type StoryProgressSummary = {
  percent: number;
  layoutMode: LayoutMode;
  savedAt: number;
};

type LastReadingState = {
  storyKey: StoryKey;
  layoutMode: LayoutMode;
  savedAt: number;
};

const MAX_PARTICIPANTS = 3;
const ACTIVE_LIMIT_MS = 5 * 60 * 1000;

const PARTICIPANT_ID_KEY = "sharedReadingParticipantId_v10";
const PARTICIPANT_JOINED_AT_KEY = "sharedReadingParticipantJoinedAt_v10";
const READING_PROGRESS_KEY_PREFIX = "sharedReadingProgress_v1";
const LAST_READING_STATE_KEY = "sharedReadingLastState_v1";

function getReadingProgressKey(storyKey: StoryKey, layoutMode: LayoutMode) {
  return `${READING_PROGRESS_KEY_PREFIX}_${storyKey}_${layoutMode}`;
}

function isStoryKey(value: unknown): value is StoryKey {
  return typeof value === "string" && value in stories;
}

function saveLastReadingState(storyKey: StoryKey, layoutMode: LayoutMode) {
  const state: LastReadingState = {
    storyKey,
    layoutMode,
    savedAt: Date.now(),
  };

  localStorage.setItem(LAST_READING_STATE_KEY, JSON.stringify(state));
}

function loadLastReadingState() {
  const rawState = localStorage.getItem(LAST_READING_STATE_KEY);

  if (!rawState) return null;

  try {
    const state = JSON.parse(rawState) as LastReadingState;

    if (!isStoryKey(state.storyKey)) return null;
    if (state.layoutMode !== "normal" && state.layoutMode !== "grouped") {
      return null;
    }

    return state;
  } catch (error) {
    console.error("前回読書状態の読み込み失敗", error);
    return null;
  }
}

function loadProgressSummaryForStory(storyKey: StoryKey) {
  if (typeof window === "undefined") return null;

  const progressCandidates = (["normal", "grouped"] as LayoutMode[])
    .map((targetLayoutMode) => {
      const rawProgress = localStorage.getItem(
        getReadingProgressKey(storyKey, targetLayoutMode),
      );

      if (!rawProgress) return null;

      try {
        const progress = JSON.parse(rawProgress) as ReadingProgress;

        if (progress.storyKey !== storyKey) return null;
        if (
          progress.layoutMode !== "normal" &&
          progress.layoutMode !== "grouped"
        ) {
          return null;
        }

        const percent =
          typeof progress.percent === "number"
            ? progress.percent
            : typeof progress.readingUnitsLength === "number"
              ? getPercent(
                  progress.currentParagraphIndex,
                  progress.readingUnitsLength,
                )
              : null;

        if (percent === null) return null;

        return {
          percent: Math.max(0, Math.min(100, percent)),
          layoutMode: progress.layoutMode,
          savedAt: progress.savedAt,
        } satisfies StoryProgressSummary;
      } catch (error) {
        console.error("作品別進捗の読み込み失敗", error);
        return null;
      }
    })
    .filter((progress): progress is StoryProgressSummary => progress !== null)
    .sort((a, b) => b.savedAt - a.savedAt);

  return progressCandidates[0] ?? null;
}

function loadAllStoryProgressSummaries() {
  if (typeof window === "undefined") {
    return {} as Partial<Record<StoryKey, StoryProgressSummary>>;
  }

  return Object.keys(stories).reduce(
    (summaryMap, key) => {
      const storyKey = key as StoryKey;
      const summary = loadProgressSummaryForStory(storyKey);

      if (summary) {
        summaryMap[storyKey] = summary;
      }

      return summaryMap;
    },
    {} as Partial<Record<StoryKey, StoryProgressSummary>>,
  );
}

function writeReadingProgress(
  storyKey: StoryKey,
  layoutMode: LayoutMode,
  currentParagraphIndex: number,
  readingUnitsLength: number,
  scrollLeft: number,
) {
  if (readingUnitsLength <= 0) return;

  const safeIndex = Math.max(
    0,
    Math.min(currentParagraphIndex, readingUnitsLength - 1),
  );

  const progress: ReadingProgress = {
    storyKey,
    layoutMode,
    currentParagraphIndex: safeIndex,
    scrollLeft,
    savedAt: Date.now(),
    readingUnitsLength,
    percent: getPercent(safeIndex, readingUnitsLength),
  };

  localStorage.setItem(
    getReadingProgressKey(progress.storyKey, progress.layoutMode),
    JSON.stringify(progress),
  );

  saveLastReadingState(storyKey, layoutMode);
}

function createParticipantId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `participant-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getPercent(index: number, count: number) {
  if (count <= 0) return 0;

  return Math.round(((index + 1) / count) * 100);
}

function getMapPercent(index: number, count: number) {
  if (count <= 1) return 0;

  return Math.round((index / (count - 1)) * 100);
}

function getDisplayName(name: string) {
  const trimmedName = name.trim();

  if (!trimmedName) return "名前なし";
  if (trimmedName.length <= 5) return trimmedName;

  return `${trimmedName.slice(0, 5)}…`;
}

function normalizeParticipant(
  raw: Record<string, unknown>,
  id: string,
): Participant {
  const now = Date.now();

  return {
    id,
    name: typeof raw.name === "string" ? raw.name : "",
    paragraphIndex: Number(raw.paragraphIndex ?? 0),
    joinedAt: Number(raw.joinedAt ?? now),
    updatedAt: Number(raw.updatedAt ?? 0),
  };
}

function normalizeReaction(raw: Record<string, unknown>): Reaction {
  return {
    storyKey:
      typeof raw.storyKey === "string" ? (raw.storyKey as StoryKey) : "",
    emoji: typeof raw.emoji === "string" ? raw.emoji : "👍",
    comment: typeof raw.comment === "string" ? raw.comment : "",
    paragraphIndex: Number(raw.paragraphIndex ?? 0),
    participantId:
      typeof raw.participantId === "string" ? raw.participantId : "",
    participantName:
      typeof raw.participantName === "string"
        ? raw.participantName
        : "名前なし",
    time: typeof raw.time === "string" ? raw.time : "",
    createdAt: Number(raw.createdAt ?? 0),
  };
}

function convertAozoraRuby(text: string) {
  let converted = text;

  converted = converted.replace(
    /｜([^《》]+)《([^《》]+)》/g,
    "<ruby>$1<rt>$2</rt></ruby>",
  );

  converted = converted.replace(
    /([一-龠々〆ヵヶ]+)《([^《》]+)》/g,
    "<ruby>$1<rt>$2</rt></ruby>",
  );

  return converted;
}

function highlightDictionaryWords(text: string) {
  let result = text;

  Object.keys(dictionary).forEach((word) => {
    result = result.replaceAll(
      word,
      `<button class="dict-word" data-word="${word}">${word}</button>`,
    );
  });

  return result;
}

function normalizeScannedJapaneseText(text: string) {
  return (
    text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+/g, " ")

      // OCRでよく入る「文 字 の 間 の 空 白」を削除
      .replace(/([ぁ-んァ-ヶ一-龠々ー])\s+(?=[ぁ-んァ-ヶ一-龠々ー])/g, "$1")

      // 句読点・カッコ周りの空白を整理
      .replace(/\s+([、。！？!?）」』】）])/g, "$1")
      .replace(/([「『【（])\s+/g, "$1")

      // 英数字も、OCRで1文字ずつ空いたものだけ軽く戻す
      .replace(/([A-Za-z])\s+(?=[A-Za-z])/g, "$1")
      .replace(/([0-9])\s+(?=[0-9])/g, "$1")
  );
}

function normalizeForCompare(text: string) {
  return text
    .replace(/\s+/g, "")
    .replace(/[　]/g, "")
    .replace(/[「」『』【】（）()]/g, "")
    .replace(/[‐－―ー]/g, "-")
    .toLowerCase()
    .trim();
}

function isChapterHeading(line: string) {
  return /^\d+\s*[^、。！？!?「」『』【】（）()]{1,20}$/.test(line);
}

function decorateText(text: string) {
  const rubyConverted = convertAozoraRuby(text);
  return highlightDictionaryWords(rubyConverted);
}

function cleanAozoraText(
  text: string,
  title: string,
  author: string,
): Paragraph[] {
  const normalizedText = normalizeScannedJapaneseText(text).replace(
    /［＃.*?］/g,
    "",
  );

  const beforeBibliography = normalizedText.split("底本：")[0];

  const titleKey = normalizeForCompare(title);
  const authorKey = normalizeForCompare(author);

  const rawLines = beforeBibliography
    .replace(/-{5,}[\s\S]*?-{5,}/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const paragraphs: Paragraph[] = [];
  let buffer = "";

  const flushBuffer = () => {
    const trimmed = buffer.trim();
    if (!trimmed) return;

    paragraphs.push({
      text: decorateText(trimmed),
    });

    buffer = "";
  };

  const shouldRemoveTitleOrAuthor = (line: string, index: number) => {
    const key = normalizeForCompare(line);

    if (!key) return true;

    // 子見出しは必ず残す。
    // 例:「5武藤澄香」「5 武藤澄香」
    if (isChapterHeading(line)) return false;

    // タイトル・著者は本文から除外する。
    // 完全一致はどこにあっても除外する。
    if (titleKey && key === titleKey) return true;
    if (authorKey && key === authorKey) return true;

    // 先頭付近だけ、タイトル＋著者がくっついた行も除外する。
    // 例:「吾輩は猫である夏目漱石」
    if (index <= 8) {
      const titleAndAuthor = `${titleKey}${authorKey}`;
      const authorAndTitle = `${authorKey}${titleKey}`;

      if (titleAndAuthor && key === titleAndAuthor) return true;
      if (authorAndTitle && key === authorAndTitle) return true;

      if (
        titleKey &&
        authorKey &&
        key.includes(titleKey) &&
        key.includes(authorKey) &&
        key.length <= titleKey.length + authorKey.length + 4
      ) {
        return true;
      }
    }

    return false;
  };

  rawLines.forEach((originalLine, index) => {
    if (shouldRemoveTitleOrAuthor(originalLine, index)) return;

    let line = originalLine;

    /*
      子見出しと本文が同じ行にくっついた場合にも対応する。
      例: 5武藤澄香「なんかあったかいものでも飲む？」
      → 見出し「5 武藤澄香」と本文「「なんか...」」に分ける。
    */
    const headingWithBody = line.match(
      /^(\d+)\s*([^、。！？!?「」『』【】（）()\d]{1,20})(?=「|『)/,
    );

    if (headingWithBody) {
      flushBuffer();

      const headingText = `${headingWithBody[1]} ${headingWithBody[2].replace(
        /\s+/g,
        "",
      )}`;

      paragraphs.push({
        text: decorateText(headingText),
        isHeading: true,
      });

      line = line.slice(headingWithBody[0].length).trim();

      if (!line) return;
    }

    if (isChapterHeading(line)) {
      flushBuffer();

      const headingMatch = line.match(/^(\d+)\s*(.+)$/);
      const headingText = headingMatch
        ? `${headingMatch[1]} ${headingMatch[2].replace(/\s+/g, "")}`
        : line.replace(/\s+/g, "");

      paragraphs.push({
        text: decorateText(headingText),
        isHeading: true,
      });

      return;
    }

    buffer += line;

    // スキャン由来の途中改行は無視して、文末まで結合する。
    if (/[。！？!?）」』】）]$/.test(line)) {
      flushBuffer();
    }
  });

  flushBuffer();

  return paragraphs;
}

function splitIntoSentences(htmlText: string) {
  return htmlText
    .split(/(?<=。)/)
    .map((text) => text.trim())
    .filter(Boolean);
}

function buildReadingUnits(paragraphs: Paragraph[]) {
  const units: ReadingUnit[] = [];
  let unitIndex = 0;

  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (paragraph.isHeading) {
      units.push({
        unitIndex,
        paragraphIndex,
        groupIndexInParagraph: 0,
        firstSentence: paragraph.text,
        secondSentence: "",
        html: paragraph.text,
        isHeading: true,
      });

      unitIndex += 1;
      return;
    }

    const sentences = splitIntoSentences(paragraph.text);

    for (
      let sentenceIndex = 0;
      sentenceIndex < sentences.length;
      sentenceIndex += 2
    ) {
      const firstSentence = sentences[sentenceIndex] ?? "";
      const secondSentence = sentences[sentenceIndex + 1] ?? "";

      units.push({
        unitIndex,
        paragraphIndex,
        groupIndexInParagraph: Math.floor(sentenceIndex / 2),
        firstSentence,
        secondSentence,
        html: `${firstSentence}${secondSentence}`,
      });

      unitIndex += 1;
    }
  });

  return units;
}

export default function Home() {
  const [readerMode, setReaderMode] = useState<ReaderMode>("reading");

  const [layoutMode, setLayoutMode] = useState<LayoutMode>("normal");

  const [participantId, setParticipantId] = useState("");
  const [joinedAt, setJoinedAt] = useState(0);
  const [name, setName] = useState("");

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);

  const [selectedStory, setSelectedStory] = useState<StoryKey>("wagahai");

  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);

  const [selectedWord, setSelectedWord] = useState("");
  const [searchWord, setSearchWord] = useState("");
  const [wikiMeaning, setWikiMeaning] = useState("");
  const [isSearchingMeaning, setIsSearchingMeaning] = useState(false);

  const [reactionEmoji, setReactionEmoji] = useState("👍");
  const [reactionComment, setReactionComment] = useState("");

  const [isAutoScroll, setIsAutoScroll] = useState(false);
  const [autoSpeed, setAutoSpeed] = useState(17);

  const [readingProgressNotice, setReadingProgressNotice] = useState("");
  const [storyProgressSummaries, setStoryProgressSummaries] = useState<
    Partial<Record<StoryKey, StoryProgressSummary>>
  >({});

  // オート時はマーカーを飛ばさず、読書面を少しずつ横へ流す。
  // 数字を大きくすると速くなる。
  const AUTO_SCROLL_SPEED =
    layoutMode === "grouped" ? autoSpeed * 1.7 : autoSpeed;

  const paragraphRefs = useRef<(HTMLDivElement | null)[]>([]);
  const currentParagraphIndexRef = useRef(0);
  const nameRef = useRef("");
  const selectedStoryRef = useRef<StoryKey>("wagahai");
  const layoutModeRef = useRef<LayoutMode>("normal");
  const readingUnitsLengthRef = useRef(0);
  const didLoadLastReadingStateRef = useRef(false);
  const isRestoringProgressRef = useRef(false);
  const textLoadRequestIdRef = useRef(0);
  const readingAreaRef = useRef<HTMLDivElement | null>(null);
  const isProgrammaticScrollRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const progressNoticeTimerRef = useRef<number | null>(null);

  const readingUnits = useMemo(() => {
    return buildReadingUnits(paragraphs);
  }, [paragraphs]);

  const readingUnitsByParagraph = useMemo(() => {
    const map = new Map<number, ReadingUnit[]>();

    readingUnits.forEach((unit) => {
      const current = map.get(unit.paragraphIndex) ?? [];
      current.push(unit);
      map.set(unit.paragraphIndex, current);
    });

    return map;
  }, [readingUnits]);

  const currentReadingUnit = readingUnits[currentParagraphIndex];

  const activeParagraphIndex = currentReadingUnit?.paragraphIndex ?? 0;

  const activeParticipants = useMemo(() => {
    const now = Date.now();

    return participants.filter((participant) => {
      return (
        now - participant.updatedAt < ACTIVE_LIMIT_MS &&
        participant.name.trim() !== ""
      );
    });
  }, [participants]);

  const admittedParticipants = useMemo(() => {
    return activeParticipants.slice(0, MAX_PARTICIPANTS);
  }, [activeParticipants]);

  const isAdmitted = useMemo(() => {
    return admittedParticipants.some(
      (participant) => participant.id === participantId,
    );
  }, [admittedParticipants, participantId]);

  const visibleReactions = useMemo(() => {
    return reactions
      .filter((reaction) => reaction.storyKey === selectedStory)
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [reactions, selectedStory]);

  const resetToBeginning = (nextMode: LayoutMode = layoutMode) => {
    const firstIndex = 0;

    setCurrentParagraphIndex(firstIndex);
    currentParagraphIndexRef.current = firstIndex;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToFocus(firstIndex, nextMode);
      });
    });
  };

  const showReadingProgressNotice = (message: string) => {
    setReadingProgressNotice(message);

    if (progressNoticeTimerRef.current !== null) {
      window.clearTimeout(progressNoticeTimerRef.current);
    }

    progressNoticeTimerRef.current = window.setTimeout(() => {
      setReadingProgressNotice("");
    }, 2200);
  };

  const refreshStoryProgressSummaries = () => {
    setStoryProgressSummaries(loadAllStoryProgressSummaries());
  };

  const saveReadingProgress = (
    nextIndex: number = currentParagraphIndexRef.current,
    options: { showNotice?: boolean } = {},
  ) => {
    // 復元直後はブラウザの自動スクロールイベントが走ることがある。
    // ここで保存すると、せっかくの前回位置が0%で上書きされるので止める。
    if (isRestoringProgressRef.current) return;

    const readingArea = readingAreaRef.current;

    writeReadingProgress(
      selectedStoryRef.current,
      layoutModeRef.current,
      nextIndex,
      readingUnits.length,
      readingArea?.scrollLeft ?? 0,
    );

    refreshStoryProgressSummaries();

    if (options.showNotice) {
      showReadingProgressNotice("自動保存しました");
    }
  };

  const loadReadingProgress = (
    storyKey: StoryKey,
    targetLayoutMode: LayoutMode,
  ) => {
    const rawProgress = localStorage.getItem(
      getReadingProgressKey(storyKey, targetLayoutMode),
    );

    if (!rawProgress) return null;

    try {
      const progress = JSON.parse(rawProgress) as ReadingProgress;

      if (
        progress.storyKey !== storyKey ||
        progress.layoutMode !== targetLayoutMode
      ) {
        return null;
      }

      return progress;
    } catch (error) {
      console.error("読書位置の読み込み失敗", error);
      return null;
    }
  };

  const restoreReadingProgress = (
    progress: ReadingProgress,
    targetLayoutMode: LayoutMode = layoutMode,
  ) => {
    if (readingUnits.length === 0) return;

    isRestoringProgressRef.current = true;

    const safeIndex = Math.max(
      0,
      Math.min(progress.currentParagraphIndex, readingUnits.length - 1),
    );

    setCurrentParagraphIndex(safeIndex);
    currentParagraphIndexRef.current = safeIndex;
    updateLocalParticipant(safeIndex);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const readingArea = readingAreaRef.current;

        if (!readingArea) {
          isRestoringProgressRef.current = false;
          return;
        }

        // まず保存インデックスに合わせる。
        // scrollLeft が環境差で合わない時も、ここで最低限その区切りへ戻せる。
        scrollToFocus(safeIndex, targetLayoutMode);

        window.setTimeout(() => {
          if (progress.scrollLeft > 0) {
            readingArea.scrollLeft = progress.scrollLeft;
          }

          window.setTimeout(() => {
            isRestoringProgressRef.current = false;
          }, 350);
        }, 80);
      });
    });
  };

  useEffect(() => {
    let savedId = localStorage.getItem(PARTICIPANT_ID_KEY);

    if (!savedId) {
      savedId = createParticipantId();
      localStorage.setItem(PARTICIPANT_ID_KEY, savedId);
    }

    let savedJoinedAt = Number(localStorage.getItem(PARTICIPANT_JOINED_AT_KEY));

    if (!savedJoinedAt) {
      savedJoinedAt = Date.now();
      localStorage.setItem(PARTICIPANT_JOINED_AT_KEY, String(savedJoinedAt));
    }

    setParticipantId(savedId);
    setJoinedAt(savedJoinedAt);
  }, []);

  useEffect(() => {
    refreshStoryProgressSummaries();
  }, []);

  useEffect(() => {
    const lastState = loadLastReadingState();

    if (lastState) {
      setSelectedStory(lastState.storyKey);
      setLayoutMode(lastState.layoutMode);
    }

    didLoadLastReadingStateRef.current = true;
  }, []);

  // 前回読んだ作品・表示モードは、実際に読書位置を書き込む時だけ保存する。
  // ここで selectedStory/layoutMode の変更だけを保存すると、
  // 初回表示時に初期値の wagahai/normal で前回状態を上書きしてしまう。

  useEffect(() => {
    currentParagraphIndexRef.current = currentParagraphIndex;
  }, [currentParagraphIndex]);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  useEffect(() => {
    selectedStoryRef.current = selectedStory;
  }, [selectedStory]);

  useEffect(() => {
    layoutModeRef.current = layoutMode;
  }, [layoutMode]);

  useEffect(() => {
    readingUnitsLengthRef.current = readingUnits.length;
  }, [readingUnits.length]);

  useEffect(() => {
    const story = stories[selectedStory];
    const requestId = textLoadRequestIdRef.current + 1;
    textLoadRequestIdRef.current = requestId;

    const loadText = async () => {
      // 作品切り替え中の0%保存を防ぐ。
      isRestoringProgressRef.current = true;
      setCurrentParagraphIndex(0);
      currentParagraphIndexRef.current = 0;
      paragraphRefs.current = [];

      if (!("textFile" in story)) {
        if (textLoadRequestIdRef.current === requestId) {
          setParagraphs([]);
          isRestoringProgressRef.current = false;
        }
        return;
      }

      try {
        const response = await fetch(story.textFile);
        const rawText = await response.text();

        // 直前に別作品へ切り替わっていたら、古いfetch結果は捨てる。
        // これがないと「吾輩」の読み込み結果が後から来て、
        // インザメガチャーチの保存位置復元を邪魔することがある。
        if (textLoadRequestIdRef.current !== requestId) return;

        const cleanedParagraphs = cleanAozoraText(
          rawText,
          story.title,
          story.author,
        );

        setParagraphs(cleanedParagraphs);
      } catch (error) {
        console.error("本文読み込み失敗", error);

        if (textLoadRequestIdRef.current === requestId) {
          setParagraphs([]);
          isRestoringProgressRef.current = false;
        }
      }
    };

    loadText();
  }, [selectedStory]);

  useEffect(() => {
    if (readingUnits.length === 0) return;

    const savedProgress = loadReadingProgress(selectedStory, layoutMode);

    if (savedProgress) {
      restoreReadingProgress(savedProgress, layoutMode);
      writeReadingProgress(
        selectedStory,
        layoutMode,
        savedProgress.currentParagraphIndex,
        readingUnits.length,
        savedProgress.scrollLeft,
      );
      refreshStoryProgressSummaries();
      return;
    }

    resetToBeginning(layoutMode);

    window.setTimeout(() => {
      isRestoringProgressRef.current = false;
    }, 350);
  }, [readingUnits.length, selectedStory, layoutMode]);

  useEffect(() => {
    const q = query(collection(db, "participants"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((docData) =>
        normalizeParticipant(docData.data(), docData.id),
      );

      setParticipants(data);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const handleLeave = async () => {
      writeReadingProgress(
        selectedStoryRef.current,
        layoutModeRef.current,
        currentParagraphIndexRef.current,
        readingUnitsLengthRef.current,
        readingAreaRef.current?.scrollLeft ?? 0,
      );

      if (!participantId) return;

      try {
        await deleteDoc(doc(db, "participants", participantId));
      } catch (error) {
        console.error("退出削除失敗", error);
      }
    };

    window.addEventListener("beforeunload", handleLeave);

    return () => {
      handleLeave();
      window.removeEventListener("beforeunload", handleLeave);
    };
  }, [participantId]);

  useEffect(() => {
    const q = query(collection(db, "reactions"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((docData) =>
        normalizeReaction(docData.data()),
      );

      setReactions(data);
    });

    return () => unsubscribe();
  }, []);

  const saveParticipantToFirestore = async (
    nextName: string,
    nextParagraphIndex: number,
  ) => {
    if (!participantId || !joinedAt) return;

    await setDoc(
      doc(db, "participants", participantId),
      {
        name: nextName,
        paragraphIndex: nextParagraphIndex,
        joinedAt,
        updatedAt: Date.now(),
      },
      { merge: true },
    );
  };

  const updateLocalParticipant = (nextParagraphIndex: number) => {
    if (!participantId) return;

    setParticipants((prev) => {
      const exists = prev.some(
        (participant) => participant.id === participantId,
      );

      if (!exists) {
        return [
          ...prev,
          {
            id: participantId,
            name: nameRef.current || "名前なし",
            paragraphIndex: nextParagraphIndex,
            joinedAt: joinedAt || Date.now(),
            updatedAt: Date.now(),
          },
        ];
      }

      return prev.map((participant) =>
        participant.id === participantId
          ? {
              ...participant,
              name: nameRef.current || participant.name,
              paragraphIndex: nextParagraphIndex,
              updatedAt: Date.now(),
            }
          : participant,
      );
    });
  };

  const getFocusX = (mode: LayoutMode, areaRect: DOMRect) => {
    // 通常段落は文頭を少し右寄りへ。
    // 2文グループは画面中央へ。
    const ratio = mode === "normal" ? 0.82 : 0.5;
    return areaRect.left + areaRect.width * ratio;
  };

  const scrollToFocus = (index: number, mode: LayoutMode = layoutMode) => {
    const targetElement = paragraphRefs.current[index];
    const readingArea = readingAreaRef.current;

    if (!targetElement || !readingArea) return;

    const targetRect = targetElement.getBoundingClientRect();
    const areaRect = readingArea.getBoundingClientRect();

    const targetPoint =
      mode === "normal"
        ? targetRect.right
        : targetRect.left + targetRect.width / 2;

    const focusX = getFocusX(mode, areaRect);
    const diff = targetPoint - focusX;

    readingArea.scrollTo({
      left: readingArea.scrollLeft + diff,
      behavior: "auto",
    });
  };

  const updateActiveUnitByCenter = () => {
    if (isProgrammaticScrollRef.current) return;

    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
    }

    scrollFrameRef.current = requestAnimationFrame(() => {
      const readingArea = readingAreaRef.current;
      if (!readingArea) return;

      const areaRect = readingArea.getBoundingClientRect();
      const focusX = getFocusX(layoutMode, areaRect);

      let nearestIndex = currentParagraphIndexRef.current;
      let nearestDistance = Infinity;

      paragraphRefs.current.forEach((element, index) => {
        if (!element) return;

        const rect = element.getBoundingClientRect();
        const targetPoint =
          layoutMode === "normal" ? rect.right : rect.left + rect.width / 2;

        const distance = Math.abs(targetPoint - focusX);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      if (nearestIndex === currentParagraphIndexRef.current) return;

      setCurrentParagraphIndex(nearestIndex);
      currentParagraphIndexRef.current = nearestIndex;
      updateLocalParticipant(nearestIndex);
      saveReadingProgress(nearestIndex);

      if (isAdmitted) {
        saveParticipantToFirestore(nameRef.current, nearestIndex);
      }
    });
  };

  const moveToParagraph = (
    nextIndex: number,
    mode: LayoutMode = layoutMode,
  ) => {
    const safeIndex = Math.max(0, Math.min(nextIndex, readingUnits.length - 1));

    setCurrentParagraphIndex(safeIndex);
    currentParagraphIndexRef.current = safeIndex;

    updateLocalParticipant(safeIndex);

    // キー操作やクリックによるスクロール中は、
    // onScroll側の中央判定でマーカーを上書きしない。
    isProgrammaticScrollRef.current = true;

    requestAnimationFrame(() => {
      scrollToFocus(safeIndex, mode);
      saveReadingProgress(safeIndex);

      window.setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 120);
    });

    if (isAdmitted) {
      saveParticipantToFirestore(nameRef.current, safeIndex);
    }
  };

  const moveToNormalParagraph = (nextParagraphIndex: number) => {
    const safeParagraphIndex = Math.max(
      0,
      Math.min(nextParagraphIndex, paragraphs.length - 1),
    );

    const firstUnit = readingUnitsByParagraph.get(safeParagraphIndex)?.[0];

    if (!firstUnit) return;

    moveToParagraph(firstUnit.unitIndex, "normal");
  };

  useEffect(() => {
    if (!isAutoScroll) return;

    const readingArea = readingAreaRef.current;
    if (!readingArea) return;

    let animationId = 0;
    let lastTime = performance.now();
    let virtualScrollLeft = readingArea.scrollLeft;

    const updateReadingPositionForOthers = () => {
      const areaRect = readingArea.getBoundingClientRect();
      const focusX = getFocusX(layoutMode, areaRect);

      let nearestIndex = currentParagraphIndexRef.current;
      let nearestDistance = Infinity;

      paragraphRefs.current.forEach((element, index) => {
        if (!element) return;

        const rect = element.getBoundingClientRect();
        const targetPoint =
          layoutMode === "normal" ? rect.right : rect.left + rect.width / 2;

        const distance = Math.abs(targetPoint - focusX);

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      if (nearestIndex === currentParagraphIndexRef.current) return;

      setCurrentParagraphIndex(nearestIndex);
      currentParagraphIndexRef.current = nearestIndex;
      updateLocalParticipant(nearestIndex);
      saveReadingProgress(nearestIndex);

      if (isAdmitted) {
        saveParticipantToFirestore(nameRef.current, nearestIndex);
      }
    };

    const smoothScroll = (now: number) => {
      const deltaTime = (now - lastTime) / 1000;
      lastTime = now;

      virtualScrollLeft -= AUTO_SCROLL_SPEED * deltaTime;
      readingArea.scrollLeft = virtualScrollLeft;

      updateReadingPositionForOthers();

      if (virtualScrollLeft <= 0) {
        setIsAutoScroll(false);
        return;
      }

      animationId = requestAnimationFrame(smoothScroll);
    };

    animationId = requestAnimationFrame(smoothScroll);

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [isAutoScroll, layoutMode, isAdmitted, AUTO_SCROLL_SPEED]);

  const handleAddReaction = async () => {
    if (!participantId) return;

    await addDoc(collection(db, "reactions"), {
      storyKey: selectedStoryRef.current,
      emoji: reactionEmoji,
      comment: reactionComment,
      paragraphIndex: currentParagraphIndexRef.current,
      participantId,
      participantName: nameRef.current.trim() || "名前なし",
      time: new Date().toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      createdAt: Date.now(),
    });

    setReactionComment("");
  };

  const fetchWikiMeaning = async (word: string) => {
    const trimmedWord = word.trim();

    if (!trimmedWord) return;

    setWikiMeaning("");

    if (dictionary[trimmedWord]) return;

    setIsSearchingMeaning(true);

    try {
      const response = await fetch(
        `https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
          trimmedWord,
        )}`,
      );

      if (!response.ok) {
        setWikiMeaning("");
        return;
      }

      const data = await response.json();
      setWikiMeaning(data.extract || "");
    } catch (error) {
      console.error("Wikipedia検索失敗", error);
      setWikiMeaning("");
    } finally {
      setIsSearchingMeaning(false);
    }
  };

  const handleSelectWord = (word: string) => {
    const trimmedWord = word.trim();

    if (!trimmedWord) return;

    setSelectedWord(trimmedWord);
    setSearchWord(trimmedWord);
    fetchWikiMeaning(trimmedWord);
  };

  const handleReaderKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;

    const isTyping =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;

    if (isTyping) return;

    const key = event.key.toLowerCase();

    if (key === "arrowleft") {
      event.preventDefault();

      if (layoutMode === "normal") {
        moveToNormalParagraph(activeParagraphIndex + 1);
      } else {
        moveToParagraph(currentParagraphIndexRef.current + 1);
      }
    }

    if (key === "arrowright") {
      event.preventDefault();

      if (layoutMode === "normal") {
        moveToNormalParagraph(activeParagraphIndex - 1);
      } else {
        moveToParagraph(currentParagraphIndexRef.current - 1);
      }
    }

    if (key === "s") {
      event.preventDefault();
      setReaderMode("shared");
    }

    if (key === "r") {
      event.preventDefault();
      setReaderMode("reading");
    }

    if (key === "a") {
      event.preventDefault();
      setIsAutoScroll((prev) => !prev);
    }
  };

  const handleParagraphClick = (index: number) => {
    moveToParagraph(index, layoutMode);
  };

  const readingPercent = getPercent(currentParagraphIndex, readingUnits.length);

  const wordSelectHandlers = {
    onMouseUp: (event: React.MouseEvent<HTMLElement>) => {
      const selection = window.getSelection();
      const selectedText = selection?.toString().trim();

      if (!selection || !selectedText) return;

      const target = event.currentTarget;

      if (!selection.anchorNode || !target.contains(selection.anchorNode)) {
        return;
      }

      handleSelectWord(selectedText);
      selection.removeAllRanges();
    },

    onClick: (event: React.MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      const word = target.dataset.word;

      if (word) {
        handleSelectWord(word);
      }
    },
  };

  return (
    <main
      tabIndex={0}
      onKeyDown={handleReaderKeyDown}
      className="min-h-screen bg-[#f5f1e8] px-4 py-6 outline-none"
    >
      <div className="mx-auto max-w-7xl">
        <header className="mb-5 overflow-hidden rounded-[2rem] border border-[#ebe3d5] bg-white shadow-[0_18px_45px_rgba(15,23,42,0.08)]">
          <div className="grid gap-6 p-7 lg:grid-cols-[1fr_520px] lg:items-center">
            <div className="relative">
              <div className="mb-4 flex items-center gap-3">
                <div className="h-10 w-1 rounded-full bg-[#c79a53]" />
                <p className="text-xs font-bold tracking-[0.35em] text-[#b98234]">
                  SHARED READING
                </p>
              </div>

              <h1 className="font-serif text-5xl font-bold tracking-[-0.04em] text-gray-950">
                {stories[selectedStory].title}
              </h1>

              <p className="mt-3 text-lg font-semibold text-gray-500">
                {stories[selectedStory].author}
              </p>

              <div className="mt-6 inline-flex items-center gap-3 rounded-2xl border border-[#eee3d2] bg-[#fffaf0] px-5 py-3 text-sm font-bold text-gray-700">
                <span className="text-[#b98234]">👥</span>
                <span>
                  参加中：
                  <strong className="ml-1 text-lg text-[#b98234]">
                    {admittedParticipants.length}/{MAX_PARTICIPANTS}
                  </strong>
                </span>
              </div>
            </div>

            <div className="rounded-[1.5rem] border border-gray-100 bg-gray-50/80 p-4">
              <div className="grid gap-3">
                <select
                  value={selectedStory}
                  onChange={(event) => {
                    setIsAutoScroll(false);
                    setSelectedStory(event.target.value as StoryKey);
                    setSelectedWord("");
                    setSearchWord("");
                    setWikiMeaning("");
                  }}
                  className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold shadow-sm outline-none"
                >
                  {Object.entries(stories).map(([key, story]) => {
                    const storyKey = key as StoryKey;
                    const progressSummary = storyProgressSummaries[storyKey];
                    const progressLabel = progressSummary
                      ? `（${progressSummary.percent}%）`
                      : "（未読）";

                    return (
                      <option key={key} value={key}>
                        {story.title} {progressLabel}
                      </option>
                    );
                  })}
                </select>

                <div className="rounded-2xl bg-white px-4 py-3 text-xs font-bold text-gray-500 shadow-sm">
                  {storyProgressSummaries[selectedStory] ? (
                    <span>
                      前回の読書位置：
                      <span className="text-[#b98234]">
                        {storyProgressSummaries[selectedStory]?.percent}%
                      </span>
                      <span className="ml-2 text-gray-400">
                        {storyProgressSummaries[selectedStory]?.layoutMode ===
                        "grouped"
                          ? "2文グループ"
                          : "通常段落"}
                      </span>
                    </span>
                  ) : (
                    <span>この作品はまだ読書位置がありません</span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-gray-100 p-1">
                  <button
                    type="button"
                    onClick={() => setReaderMode("reading")}
                    className={`rounded-xl px-4 py-3 text-sm font-bold transition ${
                      readerMode === "reading"
                        ? "bg-white text-gray-950 shadow-sm"
                        : "text-gray-500"
                    }`}
                  >
                    一人読み
                  </button>

                  <button
                    type="button"
                    onClick={() => setReaderMode("shared")}
                    className={`rounded-xl px-4 py-3 text-sm font-bold transition ${
                      readerMode === "shared"
                        ? "bg-white text-gray-950 shadow-sm"
                        : "text-gray-500"
                    }`}
                  >
                    みんなと読む
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-2xl bg-gray-100 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAutoScroll(false);
                      setLayoutMode("normal");
                      resetToBeginning("normal");
                    }}
                    className={`rounded-xl px-4 py-3 text-sm font-bold transition ${
                      layoutMode === "normal"
                        ? "bg-white text-gray-950 shadow-sm"
                        : "text-gray-500"
                    }`}
                  >
                    通常段落
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsAutoScroll(false);
                      setLayoutMode("grouped");
                      resetToBeginning("grouped");
                    }}
                    className={`rounded-xl px-4 py-3 text-sm font-bold transition ${
                      layoutMode === "grouped"
                        ? "bg-white text-gray-950 shadow-sm"
                        : "text-gray-500"
                    }`}
                  >
                    2文グループ
                  </button>
                </div>

                <div className="rounded-2xl bg-white p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-gray-800">
                        オート読書
                      </p>
                      <p className="mt-1 text-xs font-medium text-gray-500">
                        0にすると停止します。速度は自分の画面だけに反映されます。
                      </p>
                    </div>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${
                        isAutoScroll
                          ? "bg-yellow-300 text-gray-900"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {isAutoScroll ? `${autoSpeed}px/秒` : "停止中"}
                    </span>
                  </div>

                  <input
                    type="range"
                    min="0"
                    max="45"
                    step="1"
                    value={isAutoScroll ? autoSpeed : 0}
                    onChange={(event) => {
                      const nextSpeed = Number(event.target.value);

                      if (nextSpeed <= 0) {
                        setIsAutoScroll(false);
                        return;
                      }

                      setAutoSpeed(nextSpeed);
                      setIsAutoScroll(true);
                    }}
                    className="w-full accent-yellow-300"
                    aria-label="オート読書速度"
                  />

                  <div className="mt-2 flex justify-between text-xs font-bold text-gray-400">
                    <span>停止</span>
                    <span>ゆっくり</span>
                    <span>ふつう</span>
                    <span>速い</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 px-7 py-4 text-right text-sm text-gray-500">
            ← 次へ ／ → 前へ ／ A = オート ／ S = 共有 ／ R = 一人読み
          </div>
        </header>

        <div
          className={`grid gap-6 ${
            readerMode === "shared" ? "lg:grid-cols-[1fr_320px]" : "grid-cols-1"
          }`}
        >
          <section className="overflow-hidden rounded-3xl bg-[#fffdf8] shadow-xl">
            <div className="border-b border-gray-100 px-5 py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-bold text-gray-700">
                    {readerMode === "reading"
                      ? "通常読書モード"
                      : "共有表示モード"}
                  </p>
                </div>

                <div className="text-sm text-gray-500">
                  {currentParagraphIndex + 1}区切り目 ／ {readingPercent}%
                </div>
              </div>
            </div>

            <div
              ref={readingAreaRef}
              onScroll={updateActiveUnitByCenter}
              className="relative h-[75vh] overflow-x-auto overflow-y-hidden px-8 py-8"
            >
              <div
                className={`h-full font-serif text-[1.3rem] text-gray-900 ${
                  layoutMode === "normal"
                    ? "leading-[2.1] tracking-[0.03em]"
                    : "leading-[2.4] tracking-[0.08em]"
                }`}
                style={{
                  writingMode: "vertical-rl",
                  textOrientation: "mixed",
                }}
              >
                {paragraphs.map((paragraph, index) => {
                  const paragraphUnits =
                    readingUnitsByParagraph.get(index) ?? [];

                  const isParagraphActive =
                    currentReadingUnit?.paragraphIndex === index;

                  const readersInParagraph = admittedParticipants.filter(
                    (participant) => {
                      const readerUnit =
                        readingUnits[participant.paragraphIndex];
                      return readerUnit?.paragraphIndex === index;
                    },
                  );

                  return (
                    <div
                      key={`${selectedStory}-${index}`}
                      onClick={() => {
                        const firstUnit = paragraphUnits[0];
                        if (firstUnit) {
                          handleParagraphClick(firstUnit.unitIndex);
                        }
                      }}
                      className={`relative transition ${
                        layoutMode === "normal"
                          ? `ml-4 py-1 ${
                              isParagraphActive ? "bg-yellow-50/40" : ""
                            }`
                          : `paragraph-cluster ml-8 rounded-2xl px-4 py-4 ${
                              isParagraphActive ? "is-active" : ""
                            }`
                      }`}
                    >
                      {isParagraphActive && (
                        <div
                          className={`absolute right-0 top-0 h-full w-1 rounded-full ${
                            layoutMode === "normal"
                              ? "bg-yellow-200"
                              : "bg-yellow-300"
                          }`}
                        />
                      )}

                      {layoutMode === "normal" ? (
                        <>
                          <p
                            ref={(element) => {
                              const firstUnit = paragraphUnits[0];
                              if (firstUnit) {
                                paragraphRefs.current[firstUnit.unitIndex] =
                                  element as HTMLDivElement | null;
                              }
                            }}
                            className={`leading-[2.1] ${
                              paragraph.isHeading ? "reading-heading-unit" : ""
                            }`}
                            {...wordSelectHandlers}
                            dangerouslySetInnerHTML={{
                              __html: paragraph.text,
                            }}
                          />

                          {readerMode === "shared" &&
                            readersInParagraph.length > 0 && (
                              <div className="reader-follow-badges normal-reader-follow-badges">
                                {readersInParagraph.map((reader) => (
                                  <span
                                    key={reader.id}
                                    className={`reader-follow-badge ${
                                      reader.id === participantId ? "is-me" : ""
                                    }`}
                                  >
                                    {getDisplayName(reader.name)}
                                  </span>
                                ))}
                              </div>
                            )}
                        </>
                      ) : (
                        <div
                          className="two-sentence-layout"
                          {...wordSelectHandlers}
                        >
                          {paragraphUnits.map((unit) => {
                            const isUnitActive =
                              currentParagraphIndex === unit.unitIndex;

                            const readersHere = admittedParticipants.filter(
                              (participant) =>
                                Math.abs(
                                  participant.paragraphIndex - unit.unitIndex,
                                ) <= 1,
                            );

                            return (
                              <div
                                key={unit.unitIndex}
                                role="button"
                                tabIndex={0}
                                ref={(element) => {
                                  paragraphRefs.current[unit.unitIndex] =
                                    element;
                                }}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  handleParagraphClick(unit.unitIndex);
                                }}
                                className={`reading-unit ${
                                  unit.isHeading ? "reading-heading-unit" : ""
                                } ${isUnitActive ? "is-active" : ""}`}
                              >
                                <span
                                  className="reading-unit-inner"
                                  dangerouslySetInnerHTML={{
                                    __html: unit.html,
                                  }}
                                />

                                {readerMode === "shared" &&
                                  readersHere.length > 0 && (
                                    <div className="reader-follow-badges">
                                      {readersHere.map((reader) => (
                                        <span
                                          key={reader.id}
                                          className={`reader-follow-badge ${
                                            reader.id === participantId
                                              ? "is-me"
                                              : ""
                                          }`}
                                        >
                                          {getDisplayName(reader.name)}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-gray-100 px-6 py-5">
              <div className="mb-3 flex items-center justify-between text-xs text-gray-500">
                <span>読書マップ</span>

                <span>
                  {currentParagraphIndex + 1} / {readingUnits.length} 区切り
                </span>
              </div>

              <div className="relative h-5 rounded-full bg-gray-200">
                {admittedParticipants.map((participant) => {
                  const percent = getMapPercent(
                    participant.paragraphIndex,
                    readingUnits.length,
                  );

                  return (
                    <div
                      key={participant.id}
                      className="absolute top-[-8px] flex  flex-col items-center"
                      style={{
                        right: `${percent}%`,
                      }}
                      title={`${participant.name}：${
                        participant.paragraphIndex + 1
                      }区切り目`}
                    >
                      <div className="h-9 w-[3px] rounded-full bg-blue-400" />

                      <div className="mt-1 max-w-14 truncate text-[0.6rem] text-gray-500">
                        {getDisplayName(participant.name)}
                      </div>
                    </div>
                  );
                })}

                {visibleReactions.map((reaction, index) => {
                  if (reaction.paragraphIndex > currentParagraphIndex) {
                    return null;
                  }

                  const percent = getMapPercent(
                    reaction.paragraphIndex,
                    readingUnits.length,
                  );

                  return (
                    <div
                      key={`${reaction.createdAt}-${index}`}
                      className="absolute bottom-[-4px] h-3 w-3  rounded-full bg-pink-400"
                      style={{
                        right: `${percent}%`,
                      }}
                      title={`${reaction.emoji} ${
                        reaction.paragraphIndex + 1
                      }区切り目`}
                    />
                  );
                })}
              </div>

              <div className="mt-6 flex gap-4 text-xs text-gray-500">
                <span>青：参加者</span>
                <span>桃：リアクション</span>
              </div>
            </div>
          </section>

          <aside className="sticky top-4 h-[calc(100vh-2rem)] overflow-y-auto space-y-5">
            <div className="rounded-3xl bg-white p-5 shadow-lg">
              <h2 className="mb-3 text-lg font-bold">用語検索</h2>

              <input
                type="text"
                value={searchWord}
                onChange={(event) => {
                  const nextWord = event.target.value;
                  setSearchWord(nextWord);
                  setSelectedWord(nextWord);
                }}
                onBlur={() => {
                  fetchWikiMeaning(searchWord);
                }}
                placeholder="調べたい言葉を入力"
                className="mb-3 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none"
              />

              {searchWord ? (
                <>
                  <div className="mb-2 font-bold">{selectedWord}</div>

                  {dictionary[searchWord] ? (
                    <p className="text-sm leading-loose text-gray-700">
                      {dictionary[searchWord]}
                    </p>
                  ) : isSearchingMeaning ? (
                    <p className="text-sm text-gray-500">
                      意味を調べています...
                    </p>
                  ) : wikiMeaning ? (
                    <p className="text-sm leading-loose text-gray-700">
                      {wikiMeaning}
                    </p>
                  ) : (
                    <p className="text-sm leading-loose text-gray-500">
                      自作辞書・Wikipediaでは見つかりませんでした。
                    </p>
                  )}

                  <div className="mt-4 grid gap-2">
                    <a
                      href={`https://kotobank.jp/word/${encodeURIComponent(
                        searchWord,
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl bg-gray-100 px-3 py-2 text-center text-sm font-bold"
                    >
                      コトバンクで詳しく見る
                    </a>

                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(
                        searchWord + " 意味",
                      )}`}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl bg-gray-100 px-3 py-2 text-center text-sm font-bold"
                    >
                      Googleで調べる
                    </a>
                  </div>
                </>
              ) : (
                <p className="text-sm text-gray-500">
                  本文中の言葉をなぞるか、検索欄に入力してください
                </p>
              )}
            </div>

            {readerMode === "shared" && (
              <>
                <div className="rounded-3xl bg-white p-5 shadow-lg">
                  <h2 className="mb-3 text-lg font-bold">あなたの名前</h2>

                  <input
                    type="text"
                    value={name}
                    onChange={(event) => {
                      setName(event.target.value);
                      nameRef.current = event.target.value;
                    }}
                    onBlur={() => {
                      saveParticipantToFirestore(
                        nameRef.current,
                        currentParagraphIndexRef.current,
                      );
                    }}
                    placeholder="名前を入力"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none"
                  />

                  <button
                    type="button"
                    onClick={() => {
                      saveParticipantToFirestore(
                        nameRef.current,
                        currentParagraphIndexRef.current,
                      );
                    }}
                    className="mt-3 rounded-xl bg-yellow-300 px-4 py-2 text-sm font-bold text-gray-800"
                  >
                    名前を保存
                  </button>
                </div>

                <div className="rounded-3xl bg-white p-5 shadow-lg">
                  <h2 className="mb-3 text-lg font-bold">参加者</h2>

                  <div className="space-y-3">
                    {admittedParticipants.map((participant) => (
                      <div
                        key={participant.id}
                        className="rounded-2xl bg-gray-50 px-3 py-2 text-sm"
                      >
                        <div className="font-bold">{participant.name}</div>

                        <div className="mt-1 text-xs text-gray-500">
                          {participant.paragraphIndex + 1}区切り目 ／{" "}
                          {getPercent(
                            participant.paragraphIndex,
                            readingUnits.length,
                          )}
                          %
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-3xl bg-white p-5 shadow-lg">
                  <h2 className="mb-3 text-lg font-bold">リアクション</h2>

                  <div className="mb-4 rounded-2xl bg-yellow-50 p-3">
                    <p className="mb-2 text-xs text-gray-500">
                      今の区切りにリアクション
                    </p>

                    <div className="mb-2 flex gap-2">
                      {["👍", "😮", "😢", "❤️", "🤔"].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => setReactionEmoji(emoji)}
                          className={`rounded-xl px-3 py-2 text-lg ${
                            reactionEmoji === emoji
                              ? "bg-yellow-300"
                              : "bg-white"
                          }`}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>

                    <textarea
                      value={reactionComment}
                      onChange={(event) =>
                        setReactionComment(event.target.value)
                      }
                      placeholder="コメントを書く"
                      className="h-20 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none"
                    />

                    <button
                      type="button"
                      onClick={handleAddReaction}
                      className="mt-2 w-full rounded-xl bg-yellow-300 px-4 py-2 text-sm font-bold text-gray-800"
                    >
                      追加する
                    </button>
                  </div>

                  <div className="space-y-2">
                    {visibleReactions.map((reaction, index) => (
                      <div
                        key={`${reaction.createdAt}-${index}`}
                        className="rounded-xl bg-gray-50 px-3 py-2 text-sm"
                      >
                        <div>
                          {reaction.participantName}：{reaction.emoji}
                          <span className="ml-2 text-xs text-gray-400">
                            {reaction.paragraphIndex + 1}区切り目
                          </span>
                        </div>

                        {reaction.comment && (
                          <div className="mt-1 text-gray-600">
                            {reaction.comment}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}

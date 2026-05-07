"use client";

import { useEffect, useRef, useState } from "react";
import { db } from "./firebase";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  doc,
  setDoc,
} from "firebase/firestore";

type Reaction = {
  emoji: string;
  comment: string;
  percent: number;
  time: string;
  paragraphIndex: number;
  participantId: number;
  participantName: string;
  participantColor: string;
};

type Participant = {
  id: number;
  name: string;
  color: string;
  percent: number;
  paragraphIndex: number;
  cursorX: number;
  cursorY: number;
  cursorActive: boolean;
};

const defaultParticipants: Participant[] = [
  {
    id: 1,
    name: "遊馬",
    color: "bg-yellow-300",
    percent: 0,
    paragraphIndex: 0,
    cursorX: 0,
    cursorY: 0,
    cursorActive: false,
  },
  {
    id: 2,
    name: "iPhone",
    color: "bg-green-300",
    percent: 0,
    paragraphIndex: 0,
    cursorX: 0,
    cursorY: 0,
    cursorActive: false,
  },
  {
    id: 3,
    name: "参加者3",
    color: "bg-blue-300",
    percent: 0,
    paragraphIndex: 0,
    cursorX: 0,
    cursorY: 0,
    cursorActive: false,
  },
];

const paragraphs = [
  { text: <><ruby>吾輩<rt>わがはい</rt></ruby>は<ruby>猫<rt>ねこ</rt></ruby>である。</> },
  { text: <>名前はまだない。</> },
  { text: <>どこで<ruby>生<rt>う</rt></ruby>れたかとんと<ruby>見当<rt>けんとう</rt></ruby>がつかぬ。</> },
  { text: <>何でも<ruby>薄暗<rt>うすぐら</rt></ruby>いじめじめした所でニャーニャー<ruby>泣<rt>な</rt></ruby>いていた事だけは<ruby>記憶<rt>きおく</rt></ruby>している。</> },
  { text: <>吾輩はここで始めて<ruby>人間<rt>にんげん</rt></ruby>というものを見た。</> },
  { text: <>しかもあとで聞くとそれは<ruby>書生<rt>しょせい</rt></ruby>という人間中で一番<ruby>獰悪<rt>どうあく</rt></ruby>な種族であったそうだ。</> },
  { text: <>この書生というのは時々我々を<ruby>捕<rt>つか</rt></ruby>えて<ruby>煮<rt>に</rt></ruby>て食うという話である。</> },
];

export default function Home() {
  const [readingPercent, setReadingPercent] = useState(0);
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState(0);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [comment, setComment] = useState("");
  const [activeParagraph, setActiveParagraph] = useState<number | null>(null);
  const [selectedParagraph, setSelectedParagraph] = useState<number | null>(0);
  const [openReactionPanel, setOpenReactionPanel] = useState<number | null>(null);
  const [currentParticipantId, setCurrentParticipantId] = useState(1);
  const [participants, setParticipants] = useState<Participant[]>(defaultParticipants);

  const lastSaveTime = useRef(0);

  const currentParticipant =
    participants.find((p) => p.id === currentParticipantId) || defaultParticipants[0];

  useEffect(() => {
    const savedId = localStorage.getItem("currentParticipantId");
    if (savedId) setCurrentParticipantId(Number(savedId));
  }, []);

  useEffect(() => {
    localStorage.setItem("currentParticipantId", String(currentParticipantId));
  }, [currentParticipantId]);

  useEffect(() => {
    const q = query(collection(db, "participants"));

    const unsubscribe = onSnapshot(q, async (snapshot) => {
      if (snapshot.empty) {
        for (const participant of defaultParticipants) {
          await setDoc(doc(db, "participants", String(participant.id)), participant);
        }
        return;
      }

      const data = snapshot.docs
        .map((doc) => doc.data() as Participant)
        .sort((a, b) => a.id - b.id);

      setParticipants(data);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "reactions"));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map((doc) => ({
        ...(doc.data() as Reaction),
      }));

      setReactions(data.reverse());
    });

    return () => unsubscribe();
  }, []);

  const saveParticipant = async (updated: Participant) => {
    await setDoc(doc(db, "participants", String(updated.id)), updated);
  };

  const updateReadingPositionByCursor = async (index: number) => {
    const now = Date.now();

    if (now - lastSaveTime.current < 160) {
      setActiveParagraph(index);
      setSelectedParagraph(index);
      setCurrentParagraphIndex(index);
      return;
    }

    lastSaveTime.current = now;

    const percent = Math.round(((index + 1) / paragraphs.length) * 100);

    setReadingPercent(percent);
    setCurrentParagraphIndex(index);
    setActiveParagraph(index);
    setSelectedParagraph(index);

    const target = participants.find((p) => p.id === currentParticipantId);
    if (!target) return;

    await saveParticipant({
      ...target,
      percent,
      paragraphIndex: index,
      cursorActive: true,
    });
  };

  const handlePointerLeaveReader = async () => {
    setActiveParagraph(null);

    const target = participants.find((p) => p.id === currentParticipantId);
    if (!target) return;

    await saveParticipant({
      ...target,
      cursorActive: false,
    });
  };

  const updateParticipantName = async (id: number, newName: string) => {
    const target = participants.find((participant) => participant.id === id);
    if (!target) return;

    await setDoc(doc(db, "participants", String(id)), {
      ...target,
      name: newName,
    });
  };

  const addReaction = async (emoji: string, paragraphIndex: number) => {
    const now = new Date();

    await addDoc(collection(db, "reactions"), {
      emoji,
      comment: comment.trim(),
      percent: readingPercent,
      paragraphIndex,
      participantId: currentParticipant.id,
      participantName: currentParticipant.name,
      participantColor: currentParticipant.color,
      time: now.toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    });

    setComment("");
    setOpenReactionPanel(null);
  };

  const readParagraphIndex = selectedParagraph ?? currentParagraphIndex;

  const visibleReactions = reactions.filter(
    (reaction) => reaction.paragraphIndex <= readParagraphIndex
  );

  return (
    <main className="min-h-screen bg-[#f5f1e8] px-5 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 text-center">
          <h1 className="mb-4 text-4xl font-bold">共有読書システム</h1>
          <p className="text-gray-600">
            カーソルを合わせた段落に、参加者の読書位置を表示します。
          </p>
        </header>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
          <section
            className="relative rounded-3xl bg-white p-10 text-2xl leading-loose shadow-xl"
            onPointerLeave={handlePointerLeaveReader}
          >
            {paragraphs.map((paragraph, index) => {
              const paragraphReactions = reactions.filter(
                (reaction) =>
                  reaction.paragraphIndex === index &&
                  reaction.paragraphIndex <= readParagraphIndex
              );

              const readersHere = participants.filter(
                (participant) =>
                  participant.paragraphIndex === index && participant.cursorActive
              );

              const isActive = activeParagraph === index;
              const isPanelOpen = openReactionPanel === index;

              return (
                <div
                  key={index}
                  className={`relative mt-8 first:mt-0 rounded-2xl py-3 pl-24 pr-12 transition sm:pl-40 sm:pr-20 ${
                    isActive ? "bg-yellow-50" : ""
                  }`}
                  onPointerEnter={() => updateReadingPositionByCursor(index)}
                  onPointerMove={() => updateReadingPositionByCursor(index)}
                  onClick={() => updateReadingPositionByCursor(index)}
                >
                  <div className="absolute left-0 top-2 flex h-[calc(100%-16px)] gap-2">
                    {readersHere.map((reader, readerIndex) => (
                      <div
                        key={reader.id}
                        className="relative flex items-start"
                        title={`${reader.name}：${index + 1}段落目`}
                      >
                        <div
                          className={`h-full w-2 rounded-full ${reader.color} ${
                            reader.id === currentParticipantId
                              ? "opacity-95"
                              : "opacity-50"
                          }`}
                        />

                        <div
                          className={`absolute right-4 top-0 z-20 max-w-[70px] truncate whitespace-nowrap rounded-full bg-white px-2 py-1 text-xs shadow-sm sm:max-w-none ${
                            reader.id === currentParticipantId
                              ? "opacity-100"
                              : "opacity-75"
                          }`}
                          style={{
                            transform: `translateY(${readerIndex * 28}px)`,
                          }}
                        >
                          <div className="flex items-center gap-1">
                            <span
                              className={`h-2.5 w-2.5 rounded-full ${reader.color}`}
                            />
                            <span className="text-gray-600">{reader.name}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {isActive && readersHere.length === 0 && (
                    <div className="absolute left-0 top-2 h-[calc(100%-16px)] w-2 rounded-full bg-yellow-200 opacity-60" />
                  )}

                  <p>{paragraph.text}</p>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedParagraph(index);
                      setOpenReactionPanel(isPanelOpen ? null : index);
                    }}
                    className="absolute right-2 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-yellow-100 text-lg text-gray-600 shadow-sm transition hover:scale-105 hover:bg-yellow-200 active:scale-95"
                  >
                    ＋
                  </button>

                  {paragraphReactions.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1 text-base">
                      {paragraphReactions.slice(0, 5).map((reaction, i) => (
                        <span
                          key={i}
                          className="rounded-full bg-yellow-100 px-2 py-1 text-sm shadow-sm"
                          title={reaction.comment || "コメントなし"}
                        >
                          {reaction.emoji}
                          {reaction.comment && "💬"}
                          <span className="ml-1 text-xs text-gray-500">
                            {reaction.participantName}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}

                  {isPanelOpen && (
                    <div
                      className="mt-3 max-w-md rounded-2xl border border-yellow-100 bg-white p-3 text-base leading-normal shadow-sm"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <textarea
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        maxLength={40}
                        placeholder="コメント（任意・40文字まで）"
                        className="mb-2 h-16 w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-yellow-400 focus:ring-2 focus:ring-yellow-100"
                      />

                      <div className="flex items-center justify-between gap-2">
                        <div className="flex gap-2">
                          {["👍", "🤔", "😮", "📌"].map((emoji) => (
                            <button
                              key={emoji}
                              onClick={() => addReaction(emoji, index)}
                              className="rounded-xl bg-gray-100 px-3 py-2 text-lg transition hover:scale-105 hover:bg-gray-200 active:scale-95"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>

                        <button
                          onClick={() => {
                            setOpenReactionPanel(null);
                            setComment("");
                          }}
                          className="text-xs text-gray-400 hover:text-gray-600"
                        >
                          閉じる
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </section>

          <aside className="space-y-6">
            <div className="rounded-3xl bg-white p-6 shadow-lg">
              <h2 className="mb-4 text-xl font-bold">この端末の参加者</h2>

              <select
                value={currentParticipantId}
                onChange={(e) => setCurrentParticipantId(Number(e.target.value))}
                className="mb-4 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-yellow-400 focus:ring-2 focus:ring-yellow-100"
              >
                {participants.map((participant) => (
                  <option key={participant.id} value={participant.id}>
                    {participant.name}
                  </option>
                ))}
              </select>

              <p className="rounded-2xl bg-yellow-50 px-3 py-2 text-sm text-gray-600">
                現在：{currentParticipant.name} ／ {currentParagraphIndex + 1}
                段落目
              </p>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-lg">
              <h2 className="mb-4 text-xl font-bold">読書位置</h2>

              <div className="space-y-5">
                {participants.map((participant) => (
                  <ReadingBar
                    key={participant.id}
                    name={`${participant.name || `参加者${participant.id}`} ／ ${
                      (participant.paragraphIndex ?? 0) + 1
                    }段落目`}
                    percent={participant.percent || 0}
                    color={participant.color}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-lg">
              <h2 className="mb-4 text-xl font-bold">参加者名</h2>

              <div className="space-y-5">
                {participants.map((participant) => (
                  <div key={participant.id} className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <div className={`h-3 w-3 rounded-full ${participant.color}`} />
                      <span>参加者 {participant.id}</span>
                    </div>

                    <input
                      type="text"
                      value={participant.name}
                      onChange={(e) =>
                        updateParticipantName(participant.id, e.target.value)
                      }
                      className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-yellow-400 focus:ring-2 focus:ring-yellow-100"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-lg">
              <h2 className="mb-4 text-xl font-bold">表示されたコメント</h2>

              <div className="max-h-80 space-y-2 overflow-y-auto">
                {visibleReactions.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    まだ表示できるコメントはありません。
                  </p>
                ) : (
                  visibleReactions.map((reaction, index) => (
                    <div
                      key={index}
                      className="rounded-xl bg-gray-50 px-3 py-2 text-sm"
                    >
                      <div className="font-medium">
                        {reaction.participantName} が {reaction.emoji} を押しました
                      </div>

                      {reaction.comment && (
                        <div className="mt-1 rounded-lg bg-white px-2 py-1 text-gray-700">
                          {reaction.comment}
                        </div>
                      )}

                      <div className="mt-1 text-xs text-gray-500">
                        {reaction.time} ／ {reaction.paragraphIndex + 1}段落目 ／
                        読書位置 {reaction.percent}%
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function ReadingBar({
  name,
  percent,
  color,
}: {
  name: string;
  percent: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-1 flex justify-between">
        <span>{name}</span>
        <span>{percent}%</span>
      </div>

      <div className="h-3 rounded-full bg-gray-200">
        <div
          className={`h-3 rounded-full ${color}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
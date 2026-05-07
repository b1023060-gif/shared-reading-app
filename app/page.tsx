"use client";

import { useEffect, useState } from "react";

type Reaction = {
  emoji: string;
  comment: string;
  percent: number;
  time: string;
  paragraphIndex: number;
};

type Participant = {
  id: number;
  name: string;
  color: string;
};

const paragraphs = [
  {
    text: (
      <>
        <ruby>吾輩<rt>わがはい</rt></ruby>
        は
        <ruby>猫<rt>ねこ</rt></ruby>
        である。
      </>
    ),
  },
  { text: <>名前はまだない。</> },
  {
    text: (
      <>
        どこで
        <ruby>生<rt>う</rt></ruby>
        れたかとんと
        <ruby>見当<rt>けんとう</rt></ruby>
        がつかぬ。
      </>
    ),
  },
  {
    text: (
      <>
        何でも
        <ruby>薄暗<rt>うすぐら</rt></ruby>
        いじめじめした所でニャーニャー
        <ruby>泣<rt>な</rt></ruby>
        いていた事だけは
        <ruby>記憶<rt>きおく</rt></ruby>
        している。
      </>
    ),
  },
  {
    text: (
      <>
        吾輩はここで始めて
        <ruby>人間<rt>にんげん</rt></ruby>
        というものを見た。
      </>
    ),
  },
  {
    text: (
      <>
        しかもあとで聞くとそれは
        <ruby>書生<rt>しょせい</rt></ruby>
        という人間中で一番
        <ruby>獰悪<rt>どうあく</rt></ruby>
        な種族であったそうだ。
      </>
    ),
  },
  {
    text: (
      <>
        この書生というのは時々我々を
        <ruby>捕<rt>つか</rt></ruby>
        えて
        <ruby>煮<rt>に</rt></ruby>
        て食うという話である。
      </>
    ),
  },
];

export default function Home() {
  const [scrollPercent, setScrollPercent] = useState(0);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [comment, setComment] = useState("");
  const [activeParagraph, setActiveParagraph] = useState<number | null>(null);
  const [selectedParagraph, setSelectedParagraph] = useState<number | null>(0);
  const [openReactionPanel, setOpenReactionPanel] = useState<number | null>(null);

  const [participants, setParticipants] = useState<Participant[]>([
    { id: 1, name: "遊馬", color: "bg-yellow-300" },
    { id: 2, name: "木村", color: "bg-green-300" },
    { id: 3, name: "ダイアン津田", color: "bg-blue-300" },
  ]);

  const currentUser = participants[0];

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const documentHeight =
        document.documentElement.scrollHeight - window.innerHeight;

      if (documentHeight <= 0) {
        setScrollPercent(0);
        return;
      }

      const percent = Math.round((scrollTop / documentHeight) * 100);
      setScrollPercent(Math.min(100, Math.max(0, percent)));
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll);

    return () => {
      window.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const getReadParagraphIndex = () => {
    if (selectedParagraph !== null) return selectedParagraph;

    const index = Math.floor((scrollPercent / 100) * paragraphs.length);
    return Math.min(paragraphs.length - 1, Math.max(0, index));
  };

  const updateParticipantName = (id: number, newName: string) => {
    setParticipants((prev) =>
      prev.map((participant) =>
        participant.id === id ? { ...participant, name: newName } : participant
      )
    );
  };

  const addReaction = (emoji: string, paragraphIndex: number) => {
    const now = new Date();

    setReactions([
      {
        emoji,
        comment: comment.trim(),
        percent: scrollPercent,
        paragraphIndex,
        time: now.toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
      ...reactions,
    ]);

    setComment("");
    setOpenReactionPanel(null);
  };

  const readParagraphIndex = getReadParagraphIndex();

  const visibleReactions = reactions.filter(
    (reaction) => reaction.paragraphIndex <= readParagraphIndex
  );

  return (
    <main className="min-h-screen bg-[#f5f1e8] px-5 py-10">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 text-center">
          <h1 className="mb-4 text-4xl font-bold">共有読書システム</h1>

          <p className="text-gray-600">
            コメントは、その段落まで読んだ後に表示されます。
          </p>
        </header>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
          <section
            className="rounded-3xl bg-white p-10 text-2xl leading-loose shadow-xl"
            onMouseLeave={() => setActiveParagraph(null)}
          >
            {paragraphs.map((paragraph, index) => {
              const paragraphReactions = reactions.filter(
                (reaction) =>
                  reaction.paragraphIndex === index &&
                  reaction.paragraphIndex <= readParagraphIndex
              );

              const isActive = activeParagraph === index;
              const isSelected = selectedParagraph === index;
              const isPanelOpen = openReactionPanel === index;

              return (
                <div
                  key={index}
                  className={`relative mt-8 first:mt-0 rounded-2xl py-3 pl-8 pr-20 transition ${
                    isSelected ? "bg-yellow-50" : ""
                  }`}
                  onMouseEnter={() => {
                    setActiveParagraph(index);
                    setSelectedParagraph(index);
                  }}
                  onClick={() => setSelectedParagraph(index)}
                >
                  {isSelected && (
                    <div className="absolute left-0 top-2 h-[calc(100%-16px)] w-2 rounded-full bg-yellow-300 opacity-90" />
                  )}

                  {!isSelected && isActive && (
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
                    aria-label="リアクションを追加"
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
              <h2 className="mb-4 text-xl font-bold">参加者</h2>

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

                    <div className="text-xs text-gray-400">読書中</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl bg-white p-6 shadow-lg">
              <h2 className="mb-4 text-xl font-bold">読書位置</h2>

              <div className="space-y-5">
                <ReadingBar
                  name={participants[0].name || "参加者1"}
                  percent={scrollPercent}
                  color={participants[0].color}
                />
                <ReadingBar
                  name={participants[1].name || "参加者2"}
                  percent={42}
                  color={participants[1].color}
                />
                <ReadingBar
                  name={participants[2].name || "参加者3"}
                  percent={28}
                  color={participants[2].color}
                />
              </div>

              <p className="mt-4 rounded-2xl bg-yellow-50 px-3 py-2 text-sm text-gray-600">
                反応先：
                {selectedParagraph !== null
                  ? `${selectedParagraph + 1}段落目`
                  : activeParagraph !== null
                    ? `${activeParagraph + 1}段落目`
                    : "段落を選んでください"}
              </p>
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
                        {currentUser.name || "参加者1"} が {reaction.emoji} を押しました
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
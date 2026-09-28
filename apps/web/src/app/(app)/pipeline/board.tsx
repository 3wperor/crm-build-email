"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type Announcements,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { CalendarCheck, GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { moveOpportunity } from "./actions";

export type BoardStage = { id: string; name: string; kind: string; is_entry: boolean };
export type BoardCard = {
  id: string;
  stage_id: string;
  lead_id: string;
  name: string;
  email: string;
  company: string | null;
  campaign: string | null;
  booking_link: string | null;
  moved_at: string;
  source: string;
  last_reply: { snippet: string; classification: string | null; at: string } | null;
};

/**
 * Keyboard dragging: ←/→ jump straight to the neighbouring column (the
 * default moves 25px per press, which never reaches the next column).
 * Space/Enter picks up and drops, Escape cancels.
 */
const columnJump: KeyboardCoordinateGetter = (event, { context: { droppableRects, droppableContainers, collisionRect } }) => {
  const dir = event.code === "ArrowRight" ? 1 : event.code === "ArrowLeft" ? -1 : 0;
  if (!dir || !collisionRect) return undefined;
  event.preventDefault();
  const columns = droppableContainers
    .getEnabled()
    .map((c) => droppableRects.get(c.id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.left - b.left);
  const center = collisionRect.left + collisionRect.width / 2;
  const target = dir > 0 ? columns.find((r) => r.left > center) : [...columns].reverse().find((r) => r.left + r.width < center);
  if (!target) return undefined;
  return { x: target.left + (target.width - collisionRect.width) / 2, y: collisionRect.top };
};

function daysAgo(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  return d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`;
}

const KIND_ACCENT = { open: "border-t-primary/30", won: "border-t-emerald-500", lost: "border-t-destructive/60" } as const;

export function Board({ stages, cards: initial, canEdit }: { stages: BoardStage[]; cards: BoardCard[]; canEdit: boolean }) {
  const [cards, setCards] = useState(initial);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Server refreshes (realtime, other tabs) replace local state.
  const [lastInitial, setLastInitial] = useState(initial);
  if (initial !== lastInitial) {
    setLastInitial(initial);
    setCards(initial);
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: columnJump }));
  const byStage = useMemo(() => {
    const m = new Map<string, BoardCard[]>(stages.map((s) => [s.id, []]));
    for (const c of cards) m.get(c.stage_id)?.push(c);
    for (const list of m.values()) list.sort((a, b) => b.moved_at.localeCompare(a.moved_at));
    return m;
  }, [cards, stages]);

  function move(cardId: string, stageId: string) {
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.stage_id === stageId) return;
    const previous = cards;
    setError(null);
    setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, stage_id: stageId, moved_at: new Date().toISOString() } : c)));
    startTransition(async () => {
      const res = await moveOpportunity(cardId, stageId);
      if (res.error) {
        setCards(previous); // roll back the optimistic move
        setError(res.error);
      }
    });
  }

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (e.over) move(String(e.active.id), String(e.over.id));
  };
  const active = cards.find((c) => c.id === activeId);

  // Screen-reader announcements with names instead of internal ids.
  const nameOf = (id: string | number) => cards.find((c) => c.id === id)?.name ?? "card";
  const stageName = (id: string | number | undefined) => stages.find((s) => s.id === id)?.name ?? "no stage";
  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${nameOf(a.id)}. Use left and right arrows to choose a stage, space to drop, escape to cancel.`,
    onDragOver: ({ active: a, over }) => `${nameOf(a.id)} is over ${stageName(over?.id)}.`,
    onDragEnd: ({ active: a, over }) => (over ? `${nameOf(a.id)} moved to ${stageName(over.id)}.` : `${nameOf(a.id)} was dropped outside the board.`),
    onDragCancel: ({ active: a }) => `Moving ${nameOf(a.id)} was cancelled.`,
  };

  return (
    <div className="grid gap-3">
      {error && <p className="text-destructive text-sm">{error}</p>}
      <DndContext
        sensors={sensors}
        accessibility={{ announcements }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex gap-3 overflow-x-auto pb-4" data-testid="board">
          {stages.map((s) => (
            <Column key={s.id} stage={s} cards={byStage.get(s.id) ?? []} stages={stages} canEdit={canEdit} onMove={move} />
          ))}
        </div>
        <DragOverlay>{active ? <CardBody card={active} dragging /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function Column({
  stage,
  cards,
  stages,
  canEdit,
  onMove,
}: {
  stage: BoardStage;
  cards: BoardCard[];
  stages: BoardStage[];
  canEdit: boolean;
  onMove: (cardId: string, stageId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, disabled: !canEdit });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${stage.name} column`}
      data-testid={`column-${stage.name}`}
      className={cn(
        "bg-muted/40 flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-t-4 p-2 transition-colors",
        KIND_ACCENT[stage.kind as keyof typeof KIND_ACCENT] ?? "",
        isOver && "bg-primary/5 ring-primary/30 ring-2",
      )}
    >
      <header className="flex items-center justify-between px-1 py-1 text-sm font-medium">
        <span>
          {stage.name} {stage.is_entry && <span className="text-muted-foreground text-xs font-normal">(replies land here)</span>}
        </span>
        <Badge variant="outline">{cards.length}</Badge>
      </header>
      {cards.map((c) => (
        <DraggableCard key={c.id} card={c} stages={stages} canEdit={canEdit} onMove={onMove} />
      ))}
      {cards.length === 0 && <p className="text-muted-foreground px-1 py-4 text-center text-xs">Drop cards here</p>}
    </section>
  );
}

function DraggableCard({
  card,
  stages,
  canEdit,
  onMove,
}: {
  card: BoardCard;
  stages: BoardStage[];
  canEdit: boolean;
  onMove: (cardId: string, stageId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card.id, disabled: !canEdit });
  return (
    <div ref={setNodeRef} className={cn(isDragging && "opacity-40")} data-testid={`card-${card.email}`}>
      <CardBody
        card={card}
        handle={
          canEdit ? (
            <button {...listeners} {...attributes} aria-label={`Drag ${card.name}`} className="text-muted-foreground cursor-grab touch-none p-0.5">
              <GripVertical className="size-4" />
            </button>
          ) : null
        }
        footer={
          canEdit ? (
            <select
              aria-label={`Move ${card.name} to`}
              value={card.stage_id}
              onChange={(e) => onMove(card.id, e.target.value)}
              className="border-input w-full rounded border bg-transparent px-1 py-0.5 text-xs"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  Move to: {s.name}
                </option>
              ))}
            </select>
          ) : null
        }
      />
    </div>
  );
}

function CardBody({ card, handle, footer, dragging }: { card: BoardCard; handle?: React.ReactNode; footer?: React.ReactNode; dragging?: boolean }) {
  return (
    <article className={cn("bg-card grid gap-1.5 rounded-md border p-2.5 text-sm shadow-xs", dragging && "rotate-2 shadow-lg")}>
      <div className="flex items-start gap-1">
        {handle}
        <div className="min-w-0 flex-1">
          <Link href={`/leads/${card.lead_id}`} className="block truncate font-medium hover:underline">
            {card.name}
          </Link>
          <div className="text-muted-foreground truncate text-xs">{card.company ?? card.email}</div>
        </div>
        {card.booking_link && (
          <a href={card.booking_link} target="_blank" rel="noreferrer" aria-label="Booking link" className="text-muted-foreground hover:text-foreground">
            <CalendarCheck className="size-4" />
          </a>
        )}
      </div>
      {card.last_reply && (
        <p className="text-muted-foreground line-clamp-2 text-xs">
          <span className="font-medium">{card.last_reply.classification?.replace(/_/g, " ") ?? "reply"}:</span> {card.last_reply.snippet}
        </p>
      )}
      <div className="text-muted-foreground flex items-center justify-between text-[11px]">
        <span className="truncate">{card.campaign ?? (card.source === "manual" ? "Added manually" : "")}</span>
        <span>in stage {daysAgo(card.moved_at)}</span>
      </div>
      {footer}
    </article>
  );
}

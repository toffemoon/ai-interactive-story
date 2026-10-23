import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Star } from "lucide-react";
import { forwardRef, useEffect, useState } from "react";

const ShowcaseProjectCard = forwardRef(function ShowcaseProjectCard(
  { model, index, favorite, onOpen, onToggleFavorite, reducedMotion },
  ref
) {
  const [imageState, setImageState] = useState(model.cover ? "loading" : "empty");

  useEffect(() => {
    setImageState(model.cover ? "loading" : "empty");
  }, [model.cover]);

  const showImage = Boolean(model.cover) && imageState !== "error";
  const typeLabel = model.kind === "story" ? "Full story" : "Character";
  const secondary = model.meta?.uploader || model.tags?.[0] || (model.kind === "story" ? "Ready to play" : "Ready to chat");
  const overlayTags = [model.meta?.typeLabel, ...(model.tags || [])].filter(Boolean).slice(0, 2);

  return (
    <motion.article
      ref={ref}
      layout
      initial={reducedMotion ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{
        layout: reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30, mass: 0.8 },
        opacity: { duration: reducedMotion ? 0 : 0.25, ease: "easeOut" },
      }}
      whileHover={reducedMotion ? undefined : "hover"}
      className={["showcase4-card", `kind-${model.kind}`].join(" ")}
    >
      <button
        type="button"
        className="showcase4-card-open"
        aria-label={model.kind === "story" ? `View story "${model.title}"` : `View character "${model.title}"`}
        onClick={() => onOpen(model)}
      >
        <span className="showcase4-card-media">
          {showImage ? (
            <motion.img
              className="showcase4-card-image"
              src={model.cover}
              alt=""
              loading={index < 4 ? "eager" : "lazy"}
              decoding="async"
              fetchPriority={index < 4 ? "high" : "auto"}
              draggable={false}
              variants={{ hover: { scale: 1.05 } }}
              transition={{ duration: reducedMotion ? 0 : 0.6, ease: [0.22, 1, 0.36, 1] }}
              onLoad={() => setImageState("loaded")}
              onError={() => setImageState("error")}
            />
          ) : (
            <motion.span
              className="showcase4-card-placeholder t-kai"
              variants={{ hover: { scale: 1.04 } }}
              transition={{ duration: reducedMotion ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
              aria-hidden="true"
            >
              {model.title.slice(0, 4)}
            </motion.span>
          )}

          <motion.span
            className="showcase4-card-arrow"
            variants={{ hover: { opacity: 1, y: 0 } }}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            transition={{ duration: reducedMotion ? 0 : 0.3 }}
            aria-hidden="true"
          >
            <ArrowUpRight size={17} strokeWidth={1.8} />
          </motion.span>

          <span className="showcase4-card-tags" aria-hidden="true">
            {(overlayTags.length ? overlayTags : [typeLabel]).map((tag) => <i key={tag}>{tag}</i>)}
          </span>
        </span>

        <span className="showcase4-card-info">
          <span className="showcase4-card-copy">
            <strong className="showcase4-card-title t-kai">{model.title}</strong>
            <small className="t-meta">{secondary}</small>
          </span>
          <span className="showcase4-card-kind t-meta">{typeLabel}</span>
        </span>
      </button>

      <button
        type="button"
        className={["showcase4-card-favorite", favorite ? "is-active" : ""].filter(Boolean).join(" ")}
        aria-label={favorite ? `Remove "${model.title}" from favorites` : `Add "${model.title}" to favorites`}
        title={favorite ? "Remove from favorites" : "Add to favorites"}
        onClick={() => onToggleFavorite(model)}
      >
        <Star size={16} strokeWidth={1.7} fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
      </button>
    </motion.article>
  );
});

export default function ShowcaseGrid({ models, isFavorite, onOpen, onToggleFavorite, reducedMotion }) {
  return (
    <div className="showcase4-grid">
      <AnimatePresence mode="popLayout" initial={false}>
        {models.map((model, index) => (
          <ShowcaseProjectCard
            key={`${model.kind}:${model.id}`}
            model={model}
            index={index}
            favorite={isFavorite(model)}
            onOpen={onOpen}
            onToggleFavorite={onToggleFavorite}
            reducedMotion={reducedMotion}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

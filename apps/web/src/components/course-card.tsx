import Link from "next/link";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { money, dateTime } from "@edu/shared";
import { Badge, Progress } from "./ui";
export function CourseCard({
  course: c,
  enrolled = false,
}: {
  course: any;
  enrolled?: boolean;
}) {
  const cyber = c.track_name === "Cybersecurity";
  return (
    <article className="course-card">
      <div className="course-card-body">
        <div className="row spread">
          <Badge tone={cyber ? "green" : "violet"}>{c.track_name}</Badge>
          <span className="muted small">
            {enrolled ? c.batch_name || "Self-paced" : ""}
          </span>
        </div>
        <h3>
          <Link href={`/courses/${c.slug}`}>{c.title}</Link>
        </h3>
        <p>{c.subtitle}</p>
        {enrolled ? (
          <>
            <div className="row spread small">
              <span>Your progress</span>
              <strong>{Math.round(c.completion || 0)}%</strong>
            </div>
            <Progress value={Number(c.completion || 0)} />
            {c.access_expired ? (
              <>
                <p className="small" role="status">
                  Your monthly access ended {dateTime(c.access_until)}.
                </p>
                <Link className="button full" href={`/courses/${c.slug}`}>
                  Renew access <ArrowUpRight size={17} />
                </Link>
              </>
            ) : (
              <>
                {c.access_until && (
                  <p className="muted small">
                    Monthly access until {dateTime(c.access_until)}
                  </p>
                )}
                <Link
                  className="button secondary full"
                  href={
                    c.first_lesson
                      ? `/learn/${c.slug}/${c.first_lesson}`
                      : `/courses/${c.slug}`
                  }
                >
                  Continue learning <ArrowUpRight size={17} />
                </Link>
              </>
            )}
          </>
        ) : (
          <>
            <div className="course-meta">
              <span>
                <BookOpen size={15} />
                {c.lesson_count || 0}{" "}
                {Number(c.lesson_count) === 1 ? "lesson" : "lessons"}
              </span>
            </div>
            <div className="row spread course-price">
              <strong>
                {c.price === 0
                  ? "Free"
                  : c.price
                    ? money(c.price)
                    : "View options"}
              </strong>
              <Link href={`/courses/${c.slug}`}>
                View course <ArrowUpRight size={17} />
              </Link>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

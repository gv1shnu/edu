import Link from "next/link";
import { ArrowRight } from "lucide-react";
import "./home-page.css";

export function HomePage() {
  return (
    <section className="home" aria-labelledby="home-title">
      <div className="home-intro">
        <p className="home-label">Online tutoring</p>
        <h1 id="home-title">Vishnu Gandarapu</h1>
        <p className="home-description">
          Classes, practice and feedback in a small group.
        </p>
        <Link className="button home-link" href="/courses">
          View courses <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

import React from "react";
import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Heading,
  Text,
  Button,
  Hr,
} from "@react-email/components";
import { render } from "@react-email/render";
export function NotificationEmail({
  title,
  body,
  link,
}: {
  title: string;
  body: string;
  link: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
      <Body style={{ background: "#f4f5f7", fontFamily: "Arial,sans-serif" }}>
        <Container
          style={{
            background: "#fff",
            padding: "40px",
            margin: "32px auto",
            borderRadius: "16px",
          }}
        >
          <Text style={{ color: "#4f46e5", fontWeight: 700 }}>
            VISHNU / LEARN
          </Text>
          <Heading>{title}</Heading>
          <Text style={{ lineHeight: 1.7 }}>{body}</Text>
          <Button
            href={link}
            style={{
              background: "#4f46e5",
              color: "#fff",
              padding: "14px 22px",
              borderRadius: "8px",
            }}
          >
            Open your classroom
          </Button>
          <Hr />
          <Text style={{ fontSize: "12px", color: "#667085" }}>
            Independent tutoring by Vishnu Gandarapu. Classes are not recorded.
            Manage email preferences in your account settings.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
export const renderNotification = (props: {
  title: string;
  body: string;
  link: string;
}) => render(<NotificationEmail {...props} />);

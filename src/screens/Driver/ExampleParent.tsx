import React, { useEffect, useRef } from "react";
import AcceptanceCard, { AcceptanceCardHandle, Proposal } from "../../components/AcceptanceCard";

export default function DriverScreen({ socket }: { socket: any }) {
  const cardRef = useRef<AcceptanceCardHandle | null>(null);

  useEffect(() => {
    socket.on("new_proposal", (p: Proposal) => {
      cardRef.current?.pushProposal(p);
    });
    socket.on("trip_state", (state: string) => {
      cardRef.current?.setTripActive(state === "active");
    });

    return () => {
      socket.off("new_proposal");
      socket.off("trip_state");
    };
  }, [socket]);

  async function onAccept(p: Proposal) {
    await fetch(`/api/proposals/${p.id}/accept`, { method: "POST" });
  }
  async function onReject(p: Proposal) {
    await fetch(`/api/proposals/${p.id}/reject`, { method: "POST" });
  }
  async function gpsSend(coords: { lat: number; lng: number }) {
    await fetch("/api/driver/gps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(coords),
    });
  }

  useEffect(() => {
    const id = navigator.geolocation?.watchPosition(
      (pos) => {
        cardRef.current?.sendGpsUpdate({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000 }
    );
    return () => {
      if (id && navigator.geolocation) navigator.geolocation.clearWatch(id);
    };
  }, []);

  return <AcceptanceCard ref={cardRef} onAccept={onAccept} onReject={onReject} gpsSendFn={gpsSend} />;
}

import {
  LocalVideoStream,
  RemoteVideoStream,
  SkyWayContext,
  SkyWayRoom,
  SkyWayStreamFactory,
  uuidV4,
} from "@skyway-sdk/room";

(async () => {
  const screenShareButton = <HTMLButtonElement>document.getElementById("screen-share");
  const screensArea = <HTMLDivElement>document.getElementById("screens");

  const createScreenVideoElement = (id: string) => {
    const video = document.createElement("video");
    video.id = id;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.width = 1280;
    video.height = 720;
    screensArea.appendChild(video);
    return video;
  };

  const removeScreenVideoElement = (id: string) => {
    const video = <HTMLVideoElement>document.getElementById(id);
    video.pause();
    video.srcObject = null;
    if (video) {
      video.remove();
    }
  };

  const roomName = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomName = urlParams.get("roomName");
    if (roomName) return roomName;

    const newRoomName = uuidV4();
    history.replaceState(null, "", `?roomName=${newRoomName}`);
    return newRoomName;
  };

  const res = await fetch(`${process.env.TOKEN_GENERATE_API_URL}?roomName=${roomName()}`);
  const { token } = await res.json();
  const context = await SkyWayContext.Create(token);
  const room = await SkyWayRoom.FindOrCreate(context, {
    name: roomName(),
    type: "p2p",
  });
  const me = await room.join();

  room.onStreamPublished.add(async ({ publication }) => {
    if (publication.publisher.id === me.id) return;
    if (publication.contentType !== "video") return;

    const subscription = await me.subscribe<RemoteVideoStream>(publication);

    const { stream } = subscription;

    const videoElement = createScreenVideoElement(publication.publisher.id);
    stream.attach(videoElement);
    await videoElement.play();
  });
  room.onStreamUnpublished.add(({ publication }) => {
    if (publication.publisher.id === me.id) return;
    removeScreenVideoElement(publication.publisher.id);
  });

  let screenStream: LocalVideoStream | null = null;

  screenShareButton.addEventListener("click", async () => {
    if (me.publications.length > 0 && screenStream !== null) {
      await me.unpublish(me.publications[0]);
      screenStream.release();
      screenStream = null;
      removeScreenVideoElement(me.id);
      screenShareButton.textContent = "Start Screen Share";
      return;
    }

    const { video } = await SkyWayStreamFactory.createDisplayStreams();
    screenStream = video;
    const videoElement = createScreenVideoElement(me.id);
    screenStream.attach(videoElement);
    await videoElement.play();

    await me.publish(screenStream);
    screenShareButton.textContent = "Stop Screen Share";
  });
})();

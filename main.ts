import {
  LocalDataStream,
  LocalVideoStream,
  RemoteDataStream,
  RemoteVideoStream,
  SkyWayContext,
  SkyWayRoom,
  SkyWayStreamFactory,
  uuidV4,
} from "@skyway-sdk/room";

(async () => {
  const screenShareButton = <HTMLButtonElement>document.getElementById("screen-share");
  const allowRemoteControlButton = <HTMLButtonElement>document.getElementById("allow-remote-control");
  const screensArea = <HTMLDivElement>document.getElementById("screens");

  // @ts-ignore
  const controller = new CaptureController();

  let screenStream: LocalVideoStream | null = null;
  let dataStream: LocalDataStream | null = null;
  let localVideoElement: HTMLVideoElement | null = null;
  let localVideoTrackSettings: MediaTrackSettings | null = null;

  // original code is licensed under the Apache License, Version 2.0
  // ref: https://developer.chrome.com/docs/web-platform/captured-surface-control?hl=ja#scroll
  const translateCoordinates = (offsetX: number, offsetY: number) => {
    if (localVideoElement === null) return [0, 0];
    if (localVideoTrackSettings === null) return [0, 0];

    const previewDimensions = localVideoElement.getBoundingClientRect();

    const x = ((localVideoTrackSettings.width ?? 1280) * offsetX) / previewDimensions.width;
    const y = ((localVideoTrackSettings.height ?? 720) * offsetY) / previewDimensions.height;

    return [Math.floor(x), Math.floor(y)];
  };

  const createScreenVideoElement = (id: string, local = false) => {
    const video = document.createElement("video");

    video.id = id;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.width = 1280;
    video.height = 720;
    screensArea.appendChild(video);
    video.addEventListener("wheel", async (e) => {
      const { offsetX, offsetY, deltaX, deltaY } = e;
      console.log({ offsetX, offsetY, deltaX, deltaY });
      if (local) return;
      dataStream?.write({ offsetX, offsetY, deltaX, deltaY });

      //   dataStream?.write({ x, y, wheelDeltaX, wheelDeltaY });
      //   await controller.sendWheel({ x, y, wheelDeltaX, wheelDeltaY });
    });
    return video;
  };

  const removeScreenVideoElement = (id: string) => {
    const video = <HTMLVideoElement>document.getElementById(id);
    video.pause();
    video.srcObject = null;
    if (video) {
      video.remove();
    }
    localVideoElement = null;
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

  const onReceivedMessage = async (message: any) => {
    const { offsetX, offsetY, deltaX, deltaY } = message as {
      offsetX: number;
      offsetY: number;
      deltaX: number;
      deltaY: number;
    };
    const [x, y] = translateCoordinates(offsetX, offsetY);
    const [wheelDeltaX, wheelDeltaY] = [-deltaX, -deltaY];
    try {
      await controller.sendWheel({ x, y, wheelDeltaX, wheelDeltaY });
    } catch (e) {
      console.error(message, e);
    }
  };

  room.publications.forEach(async (publication) => {
    if (publication.publisher.id === me.id) return;
    if (publication.contentType === "video") {
      const subscription = await me.subscribe<RemoteVideoStream>(publication);

      const { stream } = subscription;

      const videoElement = createScreenVideoElement(publication.id);
      stream.attach(videoElement);
      await videoElement.play();
    }
    if (publication.contentType === "data") {
      const subscription = await me.subscribe<RemoteDataStream>(publication);
      subscription.stream.onData.add(async (message) => {
        await onReceivedMessage(message);
      });
    }
  });

  room.onStreamPublished.add(async ({ publication }) => {
    if (publication.publisher.id === me.id) return;
    if (publication.contentType === "video") {
      const subscription = await me.subscribe<RemoteVideoStream>(publication);

      const { stream } = subscription;

      const videoElement = createScreenVideoElement(publication.id);
      stream.attach(videoElement);
      await videoElement.play();
    }
    if (publication.contentType === "data") {
      const subscription = await me.subscribe<RemoteDataStream>(publication);
      subscription.stream.onData.add(async (message) => {
        await onReceivedMessage(message);
      });
    }
  });
  room.onStreamUnpublished.add(({ publication }) => {
    if (publication.publisher.id === me.id) return;
    if (publication.contentType === "video") {
      removeScreenVideoElement(publication.id);
    }
  });

  dataStream = await SkyWayStreamFactory.createDataStream({
    maxRetransmits: 0,
    ordered: true,
  });

  await me.publish(dataStream);

  screenShareButton.addEventListener("click", async () => {
    if (me.publications.length > 0 && screenStream !== null) {
      const [screenPublication] = me.publications.filter((p) => p.contentType === "video");
      await me.unpublish(screenPublication);
      screenStream.release();
      screenStream = null;
      removeScreenVideoElement(screenPublication.id);
      await Promise.allSettled(me.publications.filter((p) => p.contentType === "data").map((p) => me.unpublish(p)));
      screenShareButton.textContent = "Start Screen Share";
      return;
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      // @ts-ignore
      controller,
    });

    screenStream = new LocalVideoStream(stream.getVideoTracks()[0]);
    localVideoTrackSettings = screenStream.track.getSettings();
    const publication = await me.publish(screenStream);
    localVideoElement = createScreenVideoElement(publication.id, true);
    screenStream.attach(localVideoElement);

    screenShareButton.textContent = "Stop Screen Share";
  });

  allowRemoteControlButton.addEventListener("click", async () => {
    try {
      await controller.sendWheel({});
    } catch (e) {
      console.error(e);
    }
  });
})();

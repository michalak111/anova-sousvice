import Ionicons from "@expo/vector-icons/Ionicons";
import { StyleSheet, TextInput } from "react-native";

import ParallaxScrollView from "@/components/ParallaxScrollView";
import { ThemedText } from "@/components/ThemedText";
import { ThemedView } from "@/components/ThemedView";
import { BLEService } from "@/services/BLEService";
import { useEffect, useRef, useState } from "react";
import { Characteristic, Device, Subscription } from "react-native-ble-plx";
import { AnovaService } from "@/services/AnovaService";
import { noop, sleep } from "@/lib/utils";
import { Button } from "@/components/Button";

/**
 * TODO - sometimes scanning not working after app reload, needs to be killed
 * TODO - implement initial connection with loader, after timeout show troubleshooting instructions
 * TODO - update timer input from events
 */

export default function TabTwoScreen() {
  const [device, setDevice] = useState<Device>();
  const [characteristic, setCharacteristic] = useState<Characteristic>();
  const [details, setDetails] = useState<
    Partial<{
      temperature: string;
      targetTemperature: string;
      status: "start" | "stop" | "stopped" | "running";
      timer: string;
    }>
  >({ status: "stop" });
  const commandRef = useRef<{ id: string; key: AnovaService.CommandKey }>();

  const [inputTemp, setInputTemp] = useState<string>();
  const [inputTime, setInputTime] = useState<string>();

  async function scanForDevice() {
    console.log("init scanning");
    return BLEService.scanDevices(
      async (device) => {
        if (AnovaService.validateDeviceName(device)) {
          await connectToDevice(device.id);
        }
      },
      [AnovaService.DEVICE_SERVICE_UUID],
    );
  }

  async function connectToDevice(id: string) {
    const device = await BLEService.connectToDevice(id);
    setDevice(device);
    AnovaService.storeDeviceId(device.id);
    console.log("connected to device", device);
  }

  async function findCharacteistic() {
    await BLEService.discoverAllServicesAndCharacteristicsForDevice();
    const services = (await BLEService.getServicesForDevice()) || [];
    const expectedService = AnovaService.findService(services);
    if (!expectedService) {
      throw new Error("Service not found");
    }

    const characteristics = (await BLEService.getCharacteristicsForDevice(expectedService.uuid)) || [];
    const expectedCharacteristic = AnovaService.findCharacteristics(characteristics);
    if (!expectedCharacteristic) {
      throw new Error("Characteristic not found");
    }

    setCharacteristic(expectedCharacteristic);
  }

  function encode(command: string) {
    return btoa(`${command}\r`);
  }

  function decode(value: string) {
    return atob(value).replace("\r", "");
  }

  async function sendCommand(key: AnovaService.CommandKey, value: string) {
    try {
      await sleep();
      const id = Date.now().toString();
      await characteristic?.writeWithResponse(encode(value), id);
      console.log("command", id, key, value);
      commandRef.current = { id, key };
      // await new Promise<void>((resolve) => {
      //   const subscription = characteristic?.monitor((device, characteristic) => {
      //     console.log("command monitor", id, characteristic?.value && decode(characteristic.value));
      //     subscription?.remove();
      //     resolve();
      //   }, id);
      // });
    } catch (e) {
      console.log("command err", e);
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const isConnected = await BLEService.isDeviceConnected().catch(noop);

        if (isConnected) {
          const device = BLEService.getDevice();
          device && setDevice(device);
          return;
        }

        const restoredDevice = AnovaService.restoreDeviceId();
        if (restoredDevice) {
          await connectToDevice(restoredDevice).catch(() => {
            console.log("could not connect to restored device");
          });
        }
      } catch (e) {
        void AnovaService.forgetDeviceId();
        await scanForDevice();
      } finally {
        console.log("init completed");
      }
    })();
  }, []);

  useEffect(
    function listenForDeviceConenction() {
      let subscription: Subscription | null;
      if (device) {
        void findCharacteistic().catch(noop);
        subscription = BLEService.onDeviceDisconnected((error, device) => {
          console.log("disconnected", error, device);
          // device?.connect();
          BLEService.isDeviceConnected().catch(() => {
            setDevice(undefined);
            setCharacteristic(undefined);
          });
        });
      }

      return () => {
        subscription?.remove();
      };
    },
    [device],
  );

  useEffect(
    function monitorStatus() {
      const interval = setInterval(async () => {
        if (characteristic) {
          await sendCommand("read_status", AnovaService.commands["read_status"]());
          await sendCommand("read_temp", AnovaService.commands["read_temp"]());
          await sendCommand("read_target_temp", AnovaService.commands["read_target_temp"]());
          await sendCommand("read_timer", AnovaService.commands["read_timer"]());
        }
      }, 10 * 1000);

      return () => {
        clearInterval(interval);
      };
    },
    [characteristic],
  );

  useEffect(
    function monitorCharacteristics() {
      let subscription: Subscription | null;
      if (characteristic) {
        console.log("characteristic monitoring");
        subscription = characteristic.monitor((error, characteristic, ...rest) => {
          console.log("monitor log", error, characteristic, ...rest);
          if (characteristic?.value) {
            const decodedVal = decode(characteristic.value);
            console.log("monitor value", decodedVal, characteristic);
            const command = commandRef.current || { key: "" };

            commandRef.current = undefined;

            switch (command.key) {
              case "read_temp": {
                setDetails((details) => ({ ...details, temperature: decodedVal }));
                break;
              }
              case "read_timer": {
                setDetails((details) => ({ ...details, timer: decodedVal }));
                break;
              }
              case "set_target_temp":
              case "read_target_temp": {
                setDetails((details) => ({ ...details, targetTemperature: decodedVal }));
                if (!inputTemp) {
                  setInputTemp(decodedVal);
                }
                break;
              }
              case "read_status":
              case "start":
              case "stop": {
                setDetails((details) => ({ ...details, status: decodedVal as "start" | "stop" }));
                break;
              }
            }
          }
        });
      }

      return () => {
        subscription?.remove();
      };
    },
    [characteristic, commandRef],
  );

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: "#D0D0D0", dark: "#353636" }}
      headerImage={<Ionicons size={310} name="code-slash" style={styles.headerImage} />}
    >
      <ThemedView>
        {device ? (
          <ThemedView style={{ marginTop: 20 }}>
            <ThemedText>Device name: {device?.name}</ThemedText>
            <ThemedText>{details ? JSON.stringify(details, null, 2) : null}</ThemedText>

            <ThemedView style={{ marginTop: 20, flexDirection: "row", flexWrap: "wrap" }}>
              <Button
                disabled={!inputTemp}
                title={"Set temp"}
                onPress={async () => {
                  await sendCommand("set_target_temp", AnovaService.commands["set_target_temp"](Number(inputTemp)));
                }}
              />
              <ThemedView style={{ width: 10 }} />
              <TextInput
                value={inputTemp}
                style={{
                  borderColor: "#2095f3",
                  borderWidth: 1,
                  borderRadius: 12,
                  flex: 1,
                  height: 48,
                  padding: 8,
                  color: "white",
                }}
                inputMode={"decimal"}
                maxLength={4}
                onBlur={(e) => {
                  setInputTemp((text) => {
                    if (Number(text) < 5) {
                      return String(5);
                    }

                    if (Number(text) > 99.9) {
                      return String(99.9);
                    }
                    return text;
                  });
                }}
                onChangeText={(val) => {
                  setInputTemp(val);
                }}
              />
            </ThemedView>
            <ThemedView style={{ marginTop: 20, flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              <Button
                title={"Set time"}
                onPress={async () => {
                  await sendCommand("set_timer", AnovaService.commands["set_timer"](Number(inputTime)));
                }}
              />
              <TextInput
                value={inputTime}
                style={{
                  borderColor: "#2095f3",
                  borderWidth: 1,
                  borderRadius: 12,
                  flex: 1,
                  height: 48,
                  padding: 8,
                  color: "white",
                }}
                inputMode={"numeric"}
                maxLength={4}
                onBlur={() => {
                  setInputTime((text) => {
                    if (Number(text) < 0) {
                      return String(0);
                    }

                    if (Number(text) > 6000) {
                      return String(6000);
                    }
                    return text;
                  });
                }}
                onChangeText={(val) => {
                  if (details.status && ["running", "start"].includes(details.status)) {
                    return;
                  }
                  setInputTime(val);
                }}
              />
            </ThemedView>

            <ThemedView style={{ marginTop: 20, flexDirection: "row", gap: 10 }}>
              <Button
                disabled={details.status ? ["start", "running"].includes(details.status) : false}
                title={"Start"}
                onPress={async () => {
                  await sendCommand("start_time", AnovaService.commands["start_time"]());
                  await sendCommand("start", AnovaService.commands["start"]());
                  await sendCommand("read_status", AnovaService.commands["read_status"]());
                }}
              />
              <Button
                disabled={details.status ? ["stop", "stopped"].includes(details.status) : false}
                title={"Stop"}
                onPress={async () => {
                  await sendCommand("stop_time", AnovaService.commands["stop_time"]());
                  await sendCommand("stop", AnovaService.commands["stop"]());
                  await sendCommand("read_status", AnovaService.commands["read_status"]());
                }}
              />
            </ThemedView>
          </ThemedView>
        ) : null}
      </ThemedView>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: "#808080",
    bottom: -90,
    left: -35,
    position: "absolute",
  },
});

"""Example module to try the highlighter and the comment feature."""
from dataclasses import dataclass


@dataclass
class Signal:
    name: str
    samples: list[float]

    def rms(self) -> float:
        # Root-mean-square amplitude, common for EMG features
        return (sum(s * s for s in self.samples) / len(self.samples)) ** 0.5


def main():
    emg = Signal("biceps", [0.1, -0.4, 0.35, 0.2])
    print(f"{emg.name}: RMS = {emg.rms():.3f}")


if __name__ == "__main__":
    main()

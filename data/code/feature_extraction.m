% Mean absolute value over a sliding window (NinaPro-style EMG)
function mav = windowMAV(emg, win)
    n = size(emg, 1);
    mav = zeros(n - win + 1, size(emg, 2));
    for i = 1:(n - win + 1)
        mav(i, :) = mean(abs(emg(i:i+win-1, :)));
    end
end

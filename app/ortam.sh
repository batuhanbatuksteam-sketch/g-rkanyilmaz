# Android derlemesi icin gereken yollar.
# Yeni bir makinede:  brew install openjdk@21 && brew install --cask android-commandlinetools
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$JAVA_HOME/bin:$PATH"

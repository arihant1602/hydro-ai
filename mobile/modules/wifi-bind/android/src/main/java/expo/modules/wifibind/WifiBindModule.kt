package expo.modules.wifibind

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.net.Inet4Address
import java.net.NetworkInterface

// Android sends traffic over mobile data when the joined WiFi has no internet, so the ESP32's own
// network (192.168.4.1) would be unreachable. This binds the app's sockets to the WiFi network instead.
class WifiBindModule : Module() {
  private var callback: ConnectivityManager.NetworkCallback? = null

  private val cm: ConnectivityManager
    get() = appContext.reactContext!!.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

  override fun definition() = ModuleDefinition {
    Name("WifiBind")

    // Resolves true once bound to a WiFi network, false if none appears within 5 s.
    AsyncFunction("bindToWifi") { promise: Promise ->
      unbind()
      val request = NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        .build()
      var settled = false
      val cb = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
          cm.bindProcessToNetwork(network)
          if (!settled) { settled = true; promise.resolve(true) }
        }
        override fun onUnavailable() {
          if (!settled) { settled = true; promise.resolve(false) }
        }
        override fun onLost(network: Network) {
          cm.bindProcessToNetwork(null)
        }
      }
      callback = cb
      cm.requestNetwork(request, cb, 5000)
    }

    AsyncFunction("unbind") { unbind() }

    // The phone's IPv4 addresses. `tether` marks interfaces that belong to no Android Network: the phone's own
    // hotspot (or USB tethering), whose subnet Android picks at random each time it's switched on.
    AsyncFunction("localAddresses") {
      val networkIfaces = cm.allNetworks.mapNotNull { cm.getLinkProperties(it)?.interfaceName }.toSet()
      NetworkInterface.getNetworkInterfaces().toList()
        .filter { it.isUp && !it.isLoopback }
        .flatMap { iface ->
          iface.interfaceAddresses.filter { it.address is Inet4Address }.map {
            mapOf(
              "iface" to iface.name,
              "address" to it.address.hostAddress,
              "prefix" to it.networkPrefixLength.toInt(),
              "tether" to (iface.name !in networkIfaces),
            )
          }
        }
    }

    OnDestroy { unbind() }
  }

  private fun unbind() {
    callback?.let { runCatching { cm.unregisterNetworkCallback(it) } }
    callback = null
    runCatching { cm.bindProcessToNetwork(null) }
  }
}

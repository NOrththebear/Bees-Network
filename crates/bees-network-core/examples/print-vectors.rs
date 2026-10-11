fn main() {
    let h = bees_network_core::ckb_hash(b"hello");
    print!("RS ckbhash hello: 0x");
    for b in h { print!("{:02x}", b); }
    println!();
    let nid = bees_network_core::node_id_for("0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", "uuid-1").unwrap();
    print!("RS nodeId: 0x");
    for b in nid { print!("{:02x}", b); }
    println!();
    let w = hex32("9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8");
    let leaf = bees_network_core::reward_leaf(497585, &nid, &w, 10, 2, 204800, 100);
    print!("RS leaf: 0x");
    for b in leaf { print!("{:02x}", b); }
    println!();
}
fn hex32(s: &str) -> [u8; 32] {
    let mut o = [0u8; 32];
    for i in 0..32 { o[i] = u8::from_str_radix(&s[i*2..i*2+2], 16).unwrap(); }
    o
}
